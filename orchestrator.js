/* orchestrator.js */
const OpenAI = require('openai');

class Orchestrator {
    constructor(io, providersConfig) {
        this.io = io;
        this.providers = providersConfig; // Passed from server.js
        this.agents = []; 
    }

    updateAgentList(agents) {
        this.agents = agents;
    }

    async runConversation(data, socketId) {
        const socket = this.io.to(socketId);
        const { text, activeAgentIds, conversationMode } = data;

        // Filter agents who are active
        const activeAgents = this.agents.filter(a => activeAgentIds.includes(a.id));

        if (activeAgents.length === 0) {
            socket.emit('systemMessage', "⚠️ No agents selected.");
            return;
        }

        try {
            for (const agent of activeAgents) {
                socket.emit('agentStatus', { agentName: agent.name, msg: 'Thinking...' });
                
                // Get Provider Details for this Agent
                const provider = this.providers.find(p => p.id === agent.providerId);
                
                // If provider not found, default to first one (or throw error)
                if (!provider) {
                    console.error(`Provider ${agent.providerId} not found for agent ${agent.name}`);
                    return;
                }

                // Prompt Engineering
                let prompt = text;
                if (conversationMode === 'breakdown' || agent.workflow === 'breakdown') {
                    prompt = `TASK: ${text}\n\nINSTRUCTION: Breakdown into atomic steps first, then execute.`;
                }

                const result = await this.callLLM(agent, prompt, provider);
                socket.emit('agentMessage', { 
                    agentId: agent.id, 
                    name: agent.name, 
                    color: agent.avatarColor,
                    content: result 
                });
            }
        } catch (error) {
            console.error(error);
            socket.emit('systemMessage', `Error: ${error.message}`);
        }
    }

    async callLLM(agent, prompt, provider) {
        const fullPrompt = `[SYSTEM]: ${agent.systemPrompt}\n[NEGATIVE]: ${agent.negativePrompt}\n\n[USER]: ${prompt}`;

        // 1. OLLAMA PATH (Local)
        if (provider.id === 'ollama') {
            try {
                const response = await fetch(`${provider.baseURL}/api/generate`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: agent.model,
                        prompt: fullPrompt,
                        stream: false,
                        options: { 
                            temperature: parseFloat(agent.temperature),
                            num_ctx: 4096 
                        }
                    })
                });
                const data = await response.json();
                return data.response;
            } catch (e) { return `Ollama Error: ${e.message}`; }
        }

        // 2. CLOUD PATH (OpenAI / Anthropic / Custom)
        // Most cloud APIs follow OpenAI Chat Completion format
        try {
            const response = await fetch(`${provider.baseURL}/chat/completions`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${provider.apiKey}`
                },
                body: JSON.stringify({
                    model: agent.model,
                    messages: [
                        { role: "system", content: `${agent.systemPrompt}\nConstraints: ${agent.negativePrompt}` },
                        { role: "user", content: prompt }
                    ],
                    temperature: parseFloat(agent.temperature)
                })
            });
            
            const data = await response.json();
            
            // Handle different response structures (Standard OpenAI vs others)
            if (data.choices) {
                return data.choices[0].message.content;
            } else if (data.content) {
                // Some custom APIs might just return content
                return data.content;
            } else {
                return `Invalid Response from ${provider.name}`;
            }
        } catch (e) { 
            return `API Error (${provider.name}): ${e.message}`; 
        }
    }
}

module.exports = Orchestrator;