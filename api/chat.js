const { Client } = require('@notionhq/client');

const notion = new Client({
    auth: process.env.NOTION_TOKEN,
});

const DATABASE_ID = process.env.NOTION_DATABASE_ID;
const LEADS_DATABASE_ID = process.env.LEADS_DATABASE_ID;

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { message, leadData, action } = req.body;
        
        // Si es una captura de lead
        if (action === 'capture_lead' && leadData) {
            console.log('V2 - Capturando lead:', leadData);
            const result = await captureLead(leadData);
            return res.status(200).json(result);
        }
        
        // Búsqueda normal
        if (!message || typeof message !== 'string') {
            return res.status(400).json({ error: 'Message is required' });
        }

        console.log('V2 - Mensaje recibido:', message);
        console.log('V2 - Database ID:', DATABASE_ID);
        
        const answer = await searchInNotion(message);
        
        return res.status(200).json({
            success: true,
            answer: answer,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('V2 - Error en chatbot:', error);
        return res.status(500).json({
            success: false,
            answer: 'Lo siento, ha ocurrido un error técnico. Por favor, contacta con nuestro equipo para una consulta personalizada sobre financiación ENISA.'
        });
    }
};

async function searchInNotion(userMessage) {
    try {
        console.log('V2 - Consultando Notion...');
        
        const response = await notion.databases.query({
            database_id: DATABASE_ID,
            filter: {
                property: 'Activo',
                checkbox: {
                    equals: true
                }
            }
        });

        console.log('V2 - Registros encontrados:', response.results.length);
        
        const entries = response.results;
        const messageLower = userMessage.toLowerCase();
        
        if (entries.length === 0) {
            return "No hay registros activos en la base de datos. Verifica que tengas registros con el checkbox 'Activo' marcado.";
        }
        
        let bestMatch = null;
        let maxScore = 0;

        for (const entry of entries) {
            const score = calculateRelevanceScore(entry, messageLower);
            if (score > maxScore) {
                maxScore = score;
                bestMatch = entry;
            }
        }

        console.log('V2 - Mejor puntuación:', maxScore);

        if (bestMatch && maxScore > 0.1) {
            return extractAnswer(bestMatch);
        }

        return "No he encontrado información específica sobre tu consulta. Te recomiendo que contactes directamente con nuestro equipo de consultores para una asesoría personalizada sobre financiación ENISA.";
        
    } catch (error) {
        console.error('V2 - Error consultando Notion:', error);
        throw error;
    }
}

function calculateRelevanceScore(entry, userMessage) {
    let score = 0;
    
    try {
        const pregunta = getPlainText(entry.properties.Pregunta);
        const keywords = getMultiSelect(entry.properties.Keywords);
        
        keywords.forEach(keyword => {
            if (userMessage.includes(keyword.toLowerCase())) {
                score += 0.3;
            }
        });
        
        const preguntaWords = pregunta.toLowerCase().split(' ');
        const messageWords = userMessage.split(' ');
        
        preguntaWords.forEach(word => {
            if (word.length > 3 && messageWords.some(mWord => mWord.includes(word))) {
                score += 0.2;
            }
        });
        
        return score;
        
    } catch (error) {
        console.error('V2 - Error calculando relevancia:', error);
        return 0;
    }
}

function extractAnswer(entry) {
    try {
        let answer = getPlainText(entry.properties.Respuesta);
        const enlaces = getPlainText(entry.properties.Enlaces);
        
        // Procesar formato básico
        answer = answer
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')  // **negrita**
            .replace(/\*(.*?)\*/g, '<em>$1</em>')              // *cursiva*
            .replace(/^- (.*)/gm, '• $1')                      // - viñetas
            .replace(/\n/g, '<br>')                            // saltos de línea
            .replace(/^### (.*)/gm, '<h4 style="margin: 8px 0 4px 0; font-weight: 600; color: #333;">$1</h4>') // ### subtítulos
            .replace(/^## (.*)/gm, '<h3 style="margin: 12px 0 6px 0; font-weight: 700; color: #000;">$1</h3>'); // ## títulos
        
        const result = {
            text: answer,
            links: []
        };
        
        // Procesar enlaces igual que antes
        if (enlaces) {
            const linkPairs = enlaces.split(',');
            linkPairs.forEach(pair => {
                const [title, url] = pair.split('|');
                if (title && url) {
                    result.links.push({
                        title: title.trim(),
                        url: url.trim()
                    });
                }
            });
        }
        
        return JSON.stringify(result);
    } catch (error) {
        console.error('V2 - Error extrayendo respuesta:', error);
        return JSON.stringify({
            text: "Error al procesar la respuesta.",
            links: []
        });
    }
}

async function captureLead(leadData) {
    try {
        console.log('V2 - Guardando lead en Notion...');
        
        const { nombre, empresa, email, telefono, conversacion } = leadData;
        
        const response = await notion.pages.create({
            parent: { database_id: LEADS_DATABASE_ID },
            properties: {
                'Nombre': {
                    title: [
                        {
                            text: {
                                content: nombre
                            }
                        }
                    ]
                },
                'Empresa': {
                    rich_text: [
                        {
                            text: {
                                content: empresa
                            }
                        }
                    ]
                },
                'Email': {
                    email: email
                },
                'Teléfono': {
                    phone_number: telefono
                },
                'Fecha': {
                    date: {
                        start: new Date().toISOString().split('T')[0]
                    }
                },
                'Conversación': {
                    rich_text: [
                        {
                            text: {
                                content: conversacion || 'Conversación del chatbot ENISA'
                            }
                        }
                    ]
                },
                'Estado': {
                    select: {
                        name: 'Nuevo'
                    }
                }
            }
        });

        console.log('V2 - Lead guardado exitosamente:', response.id);
        
        return {
            success: true,
            message: 'Gracias por tu información. Te contactaremos pronto para tu consulta personalizada sobre ENISA.'
        };
        
    } catch (error) {
        console.error('V2 - Error guardando lead:', error);
        return {
            success: false,
            message: 'Error al procesar tu información. Por favor, contáctanos directamente.'
        };
    }
}

function getPlainText(property) {
    if (!property) return '';
    
    switch (property.type) {
        case 'title':
            return property.title.map(text => text.plain_text).join('');
        case 'rich_text':
            return property.rich_text.map(text => text.plain_text).join('');
        default:
            return '';
    }
}

function getMultiSelect(property) {
    if (!property || property.type !== 'multi_select') return [];
    return property.multi_select.map(item => item.name);
}
