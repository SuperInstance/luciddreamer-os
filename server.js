/* server.js */
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
const fs = require('fs'); 
const Orchestrator = require('./orchestrator');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// --- LOAD CONFIG WITH LOGGING ---
let appConfig = { providers: [] };
try {
    if (fs.existsSync('config.json')) {
        const configFile = fs.readFileSync('config.json', 'utf8');
        appConfig = JSON.parse(configFile);
        console.log("✅ Config loaded from config.json successfully.");
        console.log(`   Found ${appConfig.providers.length} providers.`);
    } else {
        console.log("⚠️ config.json file not found!");
    }
} catch (e) {
    console.log("❌ ERROR parsing config.json:", e.message);
}

// Fallback if config is bad/missing
if (appConfig.providers.length === 0) {
    console.log("🔄 Using fallback default config.");
    appConfig.providers = [{ 
        id: 'ollama', 
        name: 'Local Ollama', 
        baseURL: 'http://localhost:11434', 
        models: ['auto'] 
    }];
}

const orchestrator = new Orchestrator(io, appConfig.providers);

// --- ROUTES ---

// 1. Get Providers
app.get('/api/config/providers', (req, res) => {
    res.json(appConfig.providers);
});

// 2. Get Ollama Models (WITH DEBUGGING)
app.get('/api/ollama/models', async (req, res) => {
    console.log("📡 Frontend requested model list from Ollama...");
    
    try {
        // Find Ollama provider
        const ollamaProv = appConfig.providers.find(p => p.id === 'ollama');
        
        if (!ollamaProv) {
            console.log("❌ Ollama provider not found in config.json!");
            return res.json([]);
        }

        console.log(`   Connecting to: ${ollamaProv.baseURL}`);

        const response = await fetch(`${ollamaProv.baseURL}/api/tags`);
        
        if (!response.ok) {
            console.log(`❌ Ollama responded with status: ${response.status}`);
            throw new Error(`Ollama status: ${response.status}`);
        }
        
        const data = await response.json();
        const models = data.models.map(m => ({
            name: m.name, 
            sizeGB: (m.size / (1024*1024*1024)).toFixed(1),
            providerId: 'ollama'
        }));
        
        console.log(`✅ Successfully retrieved ${models.length} models from Ollama.`);
        res.json(models);
        
    } catch (e) {
        console.error("❌ Failed to fetch Ollama models:", e.message);
        // IMPORTANT: Return empty array, but ensure we don't crash
        res.json([]); 
    }
});

// 3. Agent CRUD (Keep existing)
let agents = [
    { id: 'pathos-01', name: 'Pathos', model: 'llama3.2:1b', systemPrompt: 'Identify intent.', temperature: 0.7, negativePrompt: '', workflow: 'standard', avatarColor: '#79c0ff', providerId: 'ollama' },
    { id: 'logos-01', name: 'Logos', model: 'deepseek-r1:1.5b', systemPrompt: 'Provide logic.', temperature: 0.3, negativePrompt: '', workflow: 'standard', avatarColor: '#7ee787', providerId: 'ollama' },
    { id: 'ethos-01', name: 'Ethos', model: 'phi4-mini', systemPrompt: 'Verify facts.', temperature: 0.1, negativePrompt: '', workflow: 'standard', avatarColor: '#d2a8ff', providerId: 'ollama' }
];

app.get('/api/agents', (req, res) => res.json(agents));
app.post('/api/agents', (req, res) => {
    const newAgent = { id: Date.now().toString(), ...req.body };
    agents.push(newAgent);
    io.emit('agentListUpdated', agents);
    res.json(newAgent);
});
app.delete('/api/agents/:id', (req, res) => {
    agents = agents.filter(a => a.id !== req.params.id);
    io.emit('agentListUpdated', agents);
    res.json({ success: true });
});

io.on('connection', (socket) => {
    console.log('🔌 Client connected:', socket.id);
    socket.emit('agentListUpdated', agents);
    
    socket.on('startConversation', async (data) => {
        await orchestrator.runConversation(data, socket.id);
    });

    socket.on('disconnect', () => console.log('🚪 Client disconnected'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 LucidDreamer OS V3 (Debug Mode) running on http://localhost:${PORT}`);
});