import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { motion, AnimatePresence } from "framer-motion";
import { BarChart, Bar, Tooltip, ResponsiveContainer } from "recharts";

// Configuration
const API_BASE = "http://localhost:8080/api";

const playSFX = (type) => {
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if(audioCtx.state === 'suspended') audioCtx.resume();
        const osc = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        osc.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        
        if (type === 'hover') {
            osc.type = 'sine'; osc.frequency.setValueAtTime(800, audioCtx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(1200, audioCtx.currentTime + 0.05);
            gainNode.gain.setValueAtTime(0.01, audioCtx.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.05);
            osc.start(); osc.stop(audioCtx.currentTime + 0.05);
        } else if (type === 'click') {
            osc.type = 'square'; osc.frequency.setValueAtTime(300, audioCtx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(100, audioCtx.currentTime + 0.1);
            gainNode.gain.setValueAtTime(0.03, audioCtx.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.1);
            osc.start(); osc.stop(audioCtx.currentTime + 0.1);
        } else if (type === 'success') {
            osc.type = 'triangle'; osc.frequency.setValueAtTime(600, audioCtx.currentTime);
            osc.frequency.setValueAtTime(800, audioCtx.currentTime + 0.1); osc.frequency.setValueAtTime(1200, audioCtx.currentTime + 0.2);
            gainNode.gain.setValueAtTime(0.03, audioCtx.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.5);
            osc.start(); osc.stop(audioCtx.currentTime + 0.5);
        } else if (type === 'swoosh') {
            osc.type = 'sine'; osc.frequency.setValueAtTime(200, audioCtx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(1500, audioCtx.currentTime + 0.3);
            gainNode.gain.setValueAtTime(0.05, audioCtx.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.3);
            osc.start(); osc.stop(audioCtx.currentTime + 0.3);
        }
    } catch(e){}
};

const MOCK_ACCOUNTS = [
    { vpa: "alice@demo", holderName: "Alice", balance: 5000, version: 1 },
    { vpa: "bob@demo", holderName: "Bob", balance: 2000, version: 1 },
    { vpa: "charlie@demo", holderName: "Charlie", balance: 1000, version: 1 },
    { vpa: "dave@demo", holderName: "Dave", balance: 500, version: 1 },
    { vpa: "bridge-pool@demo", holderName: "Bridge", balance: 0, version: 1 },
];

const MOCK_TX = [];
const MOCK_MESH = {
    "phone-alice": { id: "phone-alice", hasInternet: false, packetsInQueue: 0 },
    "phone-bob": { id: "phone-bob", hasInternet: false, packetsInQueue: 0 },
    "phone-charlie": { id: "phone-charlie", hasInternet: false, packetsInQueue: 0 },
    "phone-dave": { id: "phone-dave", hasInternet: false, packetsInQueue: 0 },
    "phone-bridge": { id: "phone-bridge", hasInternet: true, packetsInQueue: 0 },
};

function OpsDashboard() {
    const [mode, setMode] = useState("LIVE");
    const [accounts, setAccounts] = useState(MOCK_ACCOUNTS);
    const [transactions, setTransactions] = useState(MOCK_TX);
    const [meshState, setMeshState] = useState(MOCK_MESH);
    
    const [stats, setStats] = useState({ settled: 0, duplicate: 0, invalid: 0 });
    const [gossipRounds, setGossipRounds] = useState(0);
    const [bridgeUploads, setBridgeUploads] = useState(0);
    const [isInjectFormOpen, setInjectFormOpen] = useState(false);
    
    // Inject Form state
    const [injectSender, setInjectSender] = useState("alice@demo");
    const [injectReceiver, setInjectReceiver] = useState("bob@demo");
    const [injectAmount, setInjectAmount] = useState(500);
    const [injectPin, setInjectPin] = useState("1234");
    
    const [loading, setLoading] = useState(false);
    
    // Step state for pipeline
    const [pipelineState, setPipelineState] = useState(-1); // -1: default, 0-4
    const [pipelineOutcome, setPipelineOutcome] = useState(null); // SETTLED, DUPLICATE_DROPPED, INVALID
    const [pipelineHash, setPipelineHash] = useState("");
    const [terminalLogs, setTerminalLogs] = useState(["SYSTEM ONLINE // MESH OPS CENTER READY"]);
    
    const addLog = (msg) => {
        setTerminalLogs(prev => [...prev.slice(-15), msg]);
    };

    // Animation states
    const [animatingGossip, setAnimatingGossip] = useState(false);
    const [animatingFlush, setAnimatingFlush] = useState(false);

    // Initial Fetch & Polling
    const fetchData = async () => {
        try {
            const [accRes, txRes, meshRes] = await Promise.all([
                fetch(`${API_BASE}/accounts`),
                fetch(`${API_BASE}/transactions`),
                fetch(`${API_BASE}/mesh/state`),
            ]);
            
            if (!accRes.ok || !txRes.ok || !meshRes.ok) throw new Error("API Not OK");
            
            const accData = await accRes.json();
            const txData = await txRes.json();
            const meshData = await meshRes.json();
            
            setAccounts(accData);
            setTransactions(txData);
            setMeshState(meshData);
            setMode("LIVE");
            
            // Calculate stats
            let s = 0, d = 0, i = 0;
            txData.forEach(tx => {
                if (tx.status === "SETTLED") s++;
                if (tx.status === "DUPLICATE_DROPPED") d++;
                if (tx.status === "INVALID") i++;
            });
            setStats({ settled: s, duplicate: d, invalid: i });
            
        } catch (e) {
            console.error("API Error, falling back to mock:", e);
            setMode("MOCK");
        }
    };

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 3000);
        return () => clearInterval(interval);
    }, []);

    // API Actions
    const handleInject = async () => {
        setLoading(true);
        playSFX('swoosh');
        const hashHex = Math.random().toString(16).substring(2, 18).toUpperCase();
        addLog(`> [INJECT] Packet Encoded [Hybrid AES+RSA]. SHA: ${hashHex}`);
        try {
            if (mode === "LIVE") {
                await fetch(`${API_BASE}/demo/send`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        senderVpa: injectSender,
                        receiverVpa: injectReceiver,
                        amount: injectAmount,
                        pin: injectPin,
                        startDevice: `phone-${(injectSender || "alice").split('@')[0]}`
                    })
                });
            } else {
                // Mock local increment
                let updated = { ...meshState };
                updated[injectSender].packetsInQueue += 1;
                setMeshState(updated);
            }
            setInjectFormOpen(false);
            await fetchData();
        } catch (e) { console.error(e); }
        setLoading(false);
    };

    const handleGossip = async () => {
        setLoading(true);
        setAnimatingGossip(true);
        try {
            if (mode === "LIVE") {
                await fetch(`${API_BASE}/mesh/gossip`, { method: "POST" });
            } else {
                // mock gossip
            }
            setGossipRounds(r => r + 1);
            addLog(`> [GOSSIP ROUND ${gossipRounds+1}] Broadcasting via Bluetooth LE... Interfacing peers.`);
            setTimeout(async () => {
                await fetchData();
                setAnimatingGossip(false);
            }, 600); // 600ms match animation
        } catch (e) {
            setAnimatingGossip(false);
        }
        setLoading(false);
    };

    const handleFlush = async () => {
        setLoading(true);
        setAnimatingFlush(true);
        playSFX('click');
        addLog(`> [BRIDGE] Submitting cached payloads to Internet Endpoint...`);
        try {
            // Pipeline Animation
            setPipelineState(0); // hash
            setPipelineOutcome(null);
            setPipelineHash(Math.random().toString(16).substring(2, 8)); // mockup hash display
            
            // Simulate steps
            for (let step = 1; step <= 4; step++) {
                await new Promise(r => setTimeout(r, 300));
                setPipelineState(step);
            }
            
            let resultStatus = "SETTLED";
            if (mode === "LIVE") {
                const res = await fetch(`${API_BASE}/mesh/flush`, { method: "POST" });
                const statuses = await res.json();
                if (statuses.length > 0) resultStatus = statuses[0].outcome; // get first for demo
            }
            
            setPipelineOutcome(resultStatus);
            setBridgeUploads(u => u + 1);
            if (resultStatus === "SETTLED") { playSFX('success'); addLog(`> [SUCCESS] Transaction Settled & Committed to Ledger.`); }
            else { playSFX('click'); addLog(`> [REJECTED] Settlement dropped. Reason: ${resultStatus}`); }
            
            setTimeout(async () => {
                await fetchData();
                setAnimatingFlush(false);
                setPipelineState(-1);
            }, 1000); // Hold for 1 second before clearing
        } catch (e) {
            setAnimatingFlush(false);
        }
        setLoading(false);
    };

    const handleReset = async () => {
        setLoading(true);
        try {
            if (mode === "LIVE") {
                await fetch(`${API_BASE}/mesh/reset`, { method: "POST" });
            }
            await fetchData();
            setGossipRounds(0);
            setBridgeUploads(0);
        } catch (e) { console.error(e); }
        setLoading(false);
    };

    // Derived counts
    const totalPackets = Object.values(meshState).reduce((acc, n) => acc + (n.packetsInQueue || 0), 0);
    const maxBalance = Math.max(...accounts.map(a => a.balance), 1);

    // Chart Data
    const chartData = transactions.slice(-10).map((t, idx) => ({
        name: idx,
        settled: t.status === "SETTLED" ? 1 : 0,
        dropped: t.status === "DUPLICATE_DROPPED" ? 1 : 0
    }));

    return (
        <div className="p-4 sm:p-6 lg:p-8 max-w-[1600px] mx-auto flex flex-col min-h-screen">
            {/* HEADER */}
            <header className="flex flex-col sm:flex-row justify-between items-center mb-8 pb-4 border-b border-bordercolor">
                <div>
                    <h1 className="text-3xl font-heading text-cyan tracking-[0.1em] drop-shadow-[0_0_8px_rgba(0,229,255,0.5)]">
                        ⬡ UPI OFFLINE MESH <span className="text-gray-400 font-mono text-xl tracking-normal">· OPS CENTER</span>
                    </h1>
                    <p className="text-gray-500 font-heading tracking-widest text-sm mt-1">DISTRIBUTED PAYMENT NETWORK v0.1</p>
                </div>
                <div className="flex items-center gap-4 mt-4 sm:mt-0 font-mono text-sm">
                    <span className={`px-3 py-1 rounded-full border flex items-center gap-2 ${mode === 'LIVE' ? 'bg-[#39ff1411] border-neonGreen text-neonGreen' : 'bg-[#ffb80011] border-amber text-amber'}`}>
                        <span className={`w-2 h-2 rounded-full animate-pulse ${mode === 'LIVE' ? 'bg-neonGreen' : 'bg-amber'}`}></span>
                        {mode} MODE
                    </span>
                    <span className="text-gray-400">↻ 3s</span>
                </div>
            </header>

            {/* THREE COLUMN LAYOUT */}
            <main className="grid grid-cols-1 lg:grid-cols-12 gap-6 flex-grow">
                
                {/* ---------------- LEFT COLUMN: CONTROLS ---------------- */}
                <div className="col-span-1 lg:col-span-3 flex flex-col gap-6">
                    {/* Controls Card */}
                    <div className="cyber-card p-5">
                        <h2 className="font-heading text-cyan text-xl tracking-widest mb-4">⬡ MESH CONTROLS</h2>
                        <div className="flex flex-col gap-3">
                            <button onMouseEnter={() => playSFX('hover')} onClick={() => setInjectFormOpen(!isInjectFormOpen)} disabled={loading} className="w-full text-left px-4 py-3 bg-[#0a1520] border border-bordercolor hover:border-cyan border-l-[3px] hover:border-l-cyan transition-colors group flex justify-between items-center text-sm disabled:opacity-50">
                                <span><span className="text-gray-500 mr-2">[01]</span> ► INJECT PAYMENT</span>
                                <span className="text-cyan group-hover:drop-shadow-[0_0_5px_#00e5ff] transition-all duration-300"></span>
                            </button>
                            
                            <AnimatePresence>
                                {isInjectFormOpen && (
                                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden bg-[#0a1520] p-3 border border-bordercolor text-xs rounded-sm">
                                        <div className="flex flex-col gap-2 mb-3">
                                            <div className="flex justify-between items-center">
                                                <label className="text-gray-400">SENDER:</label>
                                                <select className="bg-[#070d14] border border-bordercolor text-white p-1" value={injectSender} onChange={(e) => setInjectSender(e.target.value)}>
                                                    {accounts.map(a => {
                                                        const vpa = a.vpa || a.accountId;
                                                        const n = a.holderName || a.name || (vpa && vpa.split('@')[0]) || vpa;
                                                        return <option key={vpa} value={vpa}>{n}</option>;
                                                    })}
                                                </select>
                                            </div>
                                            <div className="flex justify-between items-center">
                                                <label className="text-gray-400">RECEIVER:</label>
                                                <select className="bg-[#070d14] border border-bordercolor text-white p-1" value={injectReceiver} onChange={(e) => setInjectReceiver(e.target.value)}>
                                                    {accounts.map(a => {
                                                        const vpa = a.vpa || a.accountId;
                                                        const n = a.holderName || a.name || (vpa && vpa.split('@')[0]) || vpa;
                                                        return <option key={vpa} value={vpa}>{n}</option>;
                                                    })}
                                                </select>
                                            </div>
                                            <div className="flex justify-between items-center">
                                                <label className="text-gray-400">AMOUNT (₹):</label>
                                                <input type="number" className="bg-[#070d14] border border-bordercolor text-white p-1 w-20 text-right" value={injectAmount} onChange={(e) => setInjectAmount(Number(e.target.value))} />
                                            </div>
                                            <div className="flex justify-between items-center">
                                                <label className="text-gray-400">PIN:</label>
                                                <input type="password" placeholder="****" className="bg-[#070d14] border border-bordercolor text-white p-1 w-20 text-center" value={injectPin} onChange={(e) => setInjectPin(e.target.value)} />
                                            </div>
                                        </div>
                                        <button onClick={handleInject} disabled={loading} className="w-full bg-[#1a3a5c] hover:bg-cyan hover:text-navy text-cyan font-bold py-2 transition-all">SUBMIT</button>
                                    </motion.div>
                                )}
                            </AnimatePresence>

                            <button onMouseEnter={() => playSFX('hover')} onClick={handleGossip} disabled={loading} className="w-full text-left px-4 py-3 bg-[#0a1520] border border-bordercolor hover:border-cyan border-l-[3px] hover:border-l-cyan transition-colors text-sm disabled:opacity-50 flex justify-between">
                                <span><span className="text-gray-500 mr-2">[02]</span> ⟳ RUN GOSSIP ROUND</span>
                                {gossipRounds > 0 && <span className="bg-amber/20 text-amber px-2 rounded-full">{gossipRounds}</span>}
                            </button>
                            
                            <button onMouseEnter={() => playSFX('hover')} onClick={handleFlush} disabled={loading} className="w-full text-left px-4 py-3 bg-[#0a1520] border border-bordercolor hover:border-neonGreen border-l-[3px] hover:border-l-neonGreen transition-colors text-sm disabled:opacity-50">
                                <span><span className="text-gray-500 mr-2">[03]</span> ◉ FLUSH BRIDGES</span>
                            </button>
                            
                            <button onClick={handleReset} disabled={loading} className="w-full text-left px-4 py-3 bg-[#0a1520] border border-bordercolor hover:border-neonRed border-l-[3px] hover:border-l-neonRed transition-colors text-sm text-gray-400 hover:text-white disabled:opacity-50">
                                <span><span className="text-gray-500 mr-2">[04]</span> ✕ RESET MESH</span>
                            </button>
                        </div>
                    </div>

                    {/* Balances Card */}
                    <div className="cyber-card p-5 flex-grow">
                        <h2 className="font-heading text-cyan text-xl tracking-widest mb-4">⬡ ACCOUNT BALANCES</h2>
                        <div className="flex flex-col gap-4">
                            {accounts.map(acc => {
                                const vpa = acc.vpa || acc.accountId;
                                const n = acc.holderName || acc.name || (vpa && vpa.split('@')[0]) || '??';
                                return (
                                <motion.div key={vpa} 
                                    className="relative p-2 bg-[#0a1520] rounded-sm group overflow-hidden"
                                    initial={{ backgroundColor: '#0a1520' }}
                                    animate={{ backgroundColor: '#0a1520' }}
                                    // Complex flash logic requires previous state diffing, simplified here to motion key change
                                    whileInView={{ transition: { duration: 0.5 } }}
                                >
                                    <div className="flex justify-between items-center mb-1 relative z-10">
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 rounded-full bg-[#1a3a5c] flex items-center justify-center text-cyan uppercase font-bold text-sm border border-cyan/30">
                                                {n.substring(0, 2)}
                                            </div>
                                            <span className="text-gray-300 font-heading tracking-wider">{n}</span>
                                        </div>
                                        <div className="font-mono text-cyan">₹{acc.balance}</div>
                                    </div>
                                    {/* Balance fraction bar */}
                                    <div className="w-full h-1 bg-[#070d14] relative z-10">
                                        <motion.div 
                                            className="h-full bg-cyan/50"
                                            initial={{ width: 0 }}
                                            animate={{ width: `${(acc.balance / maxBalance) * 100}%` }}
                                            transition={{ type: "spring", stiffness: 50 }}
                                        />
                                    </div>
                                </motion.div>
                            )})}
                        </div>
                    </div>
                </div>


                {/* ---------------- CENTER COLUMN: MESH VISUALIZER ---------------- */}
                <div className="col-span-1 lg:col-span-6 flex flex-col gap-6">
                    <div className="cyber-card p-5 relative min-h-[500px] flex flex-col">
                        <h2 className="font-heading text-cyan text-xl tracking-widest mb-4 z-10 relative">⬡ MESH VISUALIZER</h2>
                        
                        {/* Node Graph Area */}
                        <div className="flex-grow relative border border-bordercolor/50 bg-[#070d14] p-4 flex items-center justify-center overflow-hidden min-h-[300px]">
                            {/* SVG connections */}
                            <svg className="absolute inset-0 w-full h-full pointer-events-none">
                                {/* Lines between nodes - abstract pentagon-like layout */}
                                {['alice-bob', 'bob-charlie', 'charlie-dave', 'dave-alice', 'alice-charlie', 'bob-dave', 'bridge-alice', 'bridge-bob', 'bridge-charlie', 'bridge-dave'].map((line, i) => (
                                    <g key={line}>
                                        <line x1="50%" y1="50%" x2="50%" y2="50%" stroke="#1a3a5c" strokeWidth="1" className="opacity-50" />
                                        {/* Simplification: actual layout below uses absolute CSS rather than precise SVG lines to avoid complex coordinate calculations in React for this demo, we'll draw simple decorative radial lines */}
                                        <line x1="50%" y1="20%" x2="20%" y2="50%" stroke="#1a3a5c" strokeWidth="1" />
                                        <line x1="50%" y1="20%" x2="80%" y2="50%" stroke="#1a3a5c" strokeWidth="1" />
                                        <line x1="20%" y1="50%" x2="40%" y2="80%" stroke="#1a3a5c" strokeWidth="1" />
                                        <line x1="80%" y1="50%" x2="60%" y2="80%" stroke="#1a3a5c" strokeWidth="1" />
                                        <line x1="40%" y1="80%" x2="60%" y2="80%" stroke="#1a3a5c" strokeWidth="1" />
                                        
                                        {/* Gossip Animation Lines */}
                                        {animatingGossip && (
                                            <>
                                                <motion.path 
                                                    d="M 50% 20% L 20% 50%" 
                                                    stroke="#00e5ff" strokeWidth="2" fill="none"
                                                    initial={{ pathLength: 0, opacity: 1 }}
                                                    animate={{ pathLength: 1, opacity: 0 }}
                                                    transition={{ duration: 0.6, ease: "linear" }}
                                                />
                                                <motion.path 
                                                    d="M 20% 50% L 40% 80%" 
                                                    stroke="#00e5ff" strokeWidth="2" fill="none"
                                                    initial={{ pathLength: 0, opacity: 1 }}
                                                    animate={{ pathLength: 1, opacity: 0 }}
                                                    transition={{ duration: 0.6, ease: "linear" }}
                                                />
                                                <motion.path 
                                                    d="M 80% 50% L 60% 80%" 
                                                    stroke="#00e5ff" strokeWidth="2" fill="none"
                                                    initial={{ pathLength: 0, opacity: 1 }}
                                                    animate={{ pathLength: 1, opacity: 0 }}
                                                    transition={{ duration: 0.6, ease: "linear" }}
                                                />
                                            </>
                                        )}
                                    </g>
                                ))}
                            </svg>

                            {/* Node: Bridge (top center) */}
                            <div className="absolute top-[20%] left-[50%] -translate-x-1/2 -translate-y-1/2 flex flex-col items-center group cursor-pointer">
                                {animatingFlush && (
                                    <motion.div className="absolute w-[2px] bg-cyan/80 bottom-full mb-2 origin-bottom shadow-[0_0_8px_#00e5ff]"
                                        initial={{ height: 0, opacity: 1 }}
                                        animate={{ height: 100, opacity: 0 }}
                                        transition={{ duration: 0.8 }}
                                    ><span className="absolute -top-6 -left-8 text-cyan text-[10px] w-20">▲ UPLOADING</span></motion.div>
                                )}
                                <div className="w-12 h-12 bg-surface border-2 border-cyan rounded-full flex items-center justify-center text-cyan shadow-[0_0_15px_rgba(0,229,255,0.4)] relative z-10 transition-transform group-hover:scale-110">
                                    ◉
                                    {meshState["phone-bridge"]?.packetsInQueue > 0 && <span className="absolute -top-2 -right-2 bg-amber text-black text-xs font-bold px-1.5 py-0.5 rounded-full">{meshState["phone-bridge"].packetsInQueue}</span>}
                                </div>
                                <span className="mt-2 text-cyan font-mono text-[10px] drop-shadow-md">BRIDGE · 4G</span>
                            </div>

                            {/* Node: Alice (left mid) */}
                            <div className="absolute top-[50%] left-[20%] -translate-x-1/2 -translate-y-1/2 flex flex-col items-center group cursor-pointer">
                                <div className="w-10 h-10 bg-surface border border-gray-500 rounded-full flex items-center justify-center text-gray-400 relative z-10 transition-transform group-hover:scale-110">
                                    ◈
                                    {meshState["phone-alice"]?.packetsInQueue > 0 && <span className="absolute -top-2 -right-2 bg-amber text-black text-xs font-bold px-1.5 py-0.5 rounded-full">{meshState["phone-alice"].packetsInQueue}</span>}
                                </div>
                                <span className="mt-2 text-gray-400 font-mono text-[10px]">alice</span>
                            </div>

                            {/* Node: Bob (right mid) */}
                            <div className="absolute top-[50%] left-[80%] -translate-x-1/2 -translate-y-1/2 flex flex-col items-center group cursor-pointer">
                                <div className="w-10 h-10 bg-surface border border-gray-500 rounded-full flex items-center justify-center text-gray-400 relative z-10 transition-transform group-hover:scale-110">
                                    ◈
                                    {meshState["phone-bob"]?.packetsInQueue > 0 && <span className="absolute -top-2 -right-2 bg-amber text-black text-xs font-bold px-1.5 py-0.5 rounded-full">{meshState["phone-bob"].packetsInQueue}</span>}
                                </div>
                                <span className="mt-2 text-gray-400 font-mono text-[10px]">bob</span>
                            </div>

                            {/* Node: Charlie (bottom left) */}
                            <div className="absolute top-[80%] left-[40%] -translate-x-1/2 -translate-y-1/2 flex flex-col items-center group cursor-pointer">
                                <div className="w-10 h-10 bg-surface border border-gray-500 rounded-full flex items-center justify-center text-gray-400 relative z-10 transition-transform group-hover:scale-110">
                                    ◈
                                    {meshState["phone-charlie"]?.packetsInQueue > 0 && <span className="absolute -top-2 -right-2 bg-amber text-black text-xs font-bold px-1.5 py-0.5 rounded-full">{meshState["phone-charlie"].packetsInQueue}</span>}
                                </div>
                                <span className="mt-2 text-gray-400 font-mono text-[10px]">charlie</span>
                            </div>

                            {/* Node: Dave (bottom right) */}
                            <div className="absolute top-[80%] left-[60%] -translate-x-1/2 -translate-y-1/2 flex flex-col items-center group cursor-pointer">
                                <div className="w-10 h-10 bg-surface border border-gray-500 rounded-full flex items-center justify-center text-gray-400 relative z-10 transition-transform group-hover:scale-110">
                                    ◈
                                    {meshState["phone-dave"]?.packetsInQueue > 0 && <span className="absolute -top-2 -right-2 bg-amber text-black text-xs font-bold px-1.5 py-0.5 rounded-full">{meshState["phone-dave"].packetsInQueue}</span>}
                                </div>
                                <span className="mt-2 text-gray-400 font-mono text-[10px]">dave</span>
                            </div>
                        </div>

                        {/* Pipeline Stepper */}
                        <div className="mt-6 border-t border-bordercolor pt-4 relative">
                            <h2 className="font-heading text-[12px] text-gray-500 tracking-widest mb-4">⬡ INGESTION PIPELINE</h2>
                            <div className="flex justify-between items-center px-4">
                                {['HASH', 'CLAIM', 'DECRYPT', 'FRESHNESS', 'SETTLE'].map((step, idx) => {
                                    const active = pipelineState === idx;
                                    const passed = pipelineState > idx;
                                    let color = "border-gray-700 text-gray-600";
                                    if (passed) color = "border-cyan text-cyan";
                                    if (active) color = "border-cyan bg-cyan text-navy shadow-[0_0_10px_#00e5ff]";
                                    // Custom colors for failure states
                                    if (passed && pipelineOutcome === 'DUPLICATE_DROPPED' && idx === 1) color = "border-amber bg-amber text-black shadow-[0_0_10px_#ffb800]";
                                    if (passed && pipelineOutcome === 'INVALID' && idx === 2) color = "border-neonRed bg-neonRed text-white shadow-[0_0_10px_#ff4757]";

                                    return (
                                        <div key={step} className="flex flex-col items-center">
                                            <motion.div 
                                                className={`w-10 h-10 rounded-full border-2 flex items-center justify-center text-sm font-bold transition-all duration-300 ${color}`}
                                                animate={active ? { scale: [1, 1.1, 1] } : {}}
                                            >
                                                {idx + 1}
                                            </motion.div>
                                            <span className={`text-[10px] mt-2 font-mono ${passed || active ? 'text-gray-300' : 'text-gray-600'}`}>{step}</span>
                                        </div>
                                    );
                                })}
                            </div>
                            
                            {/* Outcome Badge overlay */}
                            <div className="absolute top-4 right-0 flex gap-4 items-center">
                                {pipelineHash && <span className="text-purple font-mono text-xs">SHA: {pipelineHash}</span>}
                                {pipelineOutcome && (
                                    <motion.span 
                                        initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}
                                        className={`px-3 py-1 font-mono text-xs border rounded-sm font-bold
                                            ${pipelineOutcome === 'SETTLED' ? 'border-neonGreen text-neonGreen bg-[#39ff1411]' : ''}
                                            ${pipelineOutcome === 'DUPLICATE_DROPPED' ? 'border-amber text-amber bg-[#ffb80011]' : ''}
                                            ${pipelineOutcome === 'INVALID' ? 'border-neonRed text-neonRed bg-[#ff475711]' : ''}
                                        `}
                                    >
                                        {pipelineOutcome}
                                    </motion.span>
                                )}
                            </div>
                        </div>

                        {/* Ops Terminal */}
                        <div className="mt-4 border-t border-bordercolor pt-4 flex-grow flex flex-col min-h-[140px]">
                            <h2 className="font-heading text-[12px] text-gray-500 tracking-widest mb-2 flex justify-between">
                                <span>⬡ LIVE SNIFFER</span>
                                <span className="text-neonGreen animate-pulse">● REC</span>
                            </h2>
                            <div className="bg-[#050a0f] border border-[#1a3a5c] rounded p-3 flex-grow font-mono text-[10px] text-cyan/70 overflow-y-auto font-bold flex flex-col justify-end relative shadow-[inset_0_0_15px_rgba(0,0,0,0.8)]">
                                <AnimatePresence>
                                    {terminalLogs.map((log, i) => (
                                        <motion.div key={i} initial={{opacity:0, x:-5}} animate={{opacity:1, x:0}} className="mb-0.5 whitespace-pre-wrap">
                                            <span className="text-gray-600">[{new Date().toLocaleTimeString()}]</span> {log}
                                        </motion.div>
                                    ))}
                                </AnimatePresence>
                                <div className="absolute inset-0 bg-gradient-to-b from-[#070d14] to-transparent h-4 pointer-events-none"></div>
                            </div>
                        </div>

                    </div>
                </div>

                {/* ---------------- RIGHT COLUMN: STATS & LEDGER ---------------- */}
                <div className="col-span-1 lg:col-span-3 flex flex-col gap-6">
                    {/* Live Stats */}
                    <div className="grid grid-cols-3 gap-3">
                        <div className="cyber-card p-3 flex flex-col justify-between items-center text-center">
                            <span className="font-heading text-[10px] text-gray-400">TOTAL SETTLED</span>
                            <motion.span key={stats.settled} initial={{scale:1.5}} animate={{scale:1}} className="font-mono text-2xl text-neonGreen">{stats.settled}</motion.span>
                        </div>
                        <div className="cyber-card p-3 flex flex-col justify-between items-center text-center bg-[#0d1825]">
                            <span className="font-heading text-[10px] text-gray-400">DUPLICATES</span>
                            <motion.span key={stats.duplicate} initial={{scale:1.5}} animate={{scale:1}} className="font-mono text-2xl text-amber">{stats.duplicate}</motion.span>
                        </div>
                        <div className="cyber-card p-3 flex flex-col justify-between items-center text-center">
                            <span className="font-heading text-[10px] text-gray-400">INVALID</span>
                            <motion.span key={stats.invalid} initial={{scale:1.5}} animate={{scale:1}} className="font-mono text-2xl text-neonRed">{stats.invalid}</motion.span>
                        </div>
                    </div>

                    {/* Chart Card */}
                    <div className="cyber-card p-4 h-48 flex flex-col">
                        <h2 className="font-heading text-cyan text-sm tracking-widest mb-2">⬡ SETTLEMENT ACTIVITY</h2>
                        <div className="flex-grow">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={chartData}>
                                    <Tooltip cursor={{fill: '#1a3a5c'}} contentStyle={{backgroundColor: '#0d1825', border: '1px solid #1a3a5c'}}/>
                                    <Bar dataKey="settled" stackId="a" fill="#39ff14" />
                                    <Bar dataKey="dropped" stackId="a" fill="#ffb800" />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    {/* Ledger Card */}
                    <div className="cyber-card p-5 flex-grow overflow-hidden flex flex-col">
                        <h2 className="font-heading text-cyan text-xl tracking-widest mb-4">⬡ LEDGER</h2>
                        <div className="flex-grow overflow-y-auto pr-2 flex flex-col gap-2">
                            <AnimatePresence>
                                {transactions.length === 0 ? <div className="text-gray-500 font-mono text-sm text-center mt-10">No transactions recorded</div> :
                                 transactions.map((tx, idx) => (
                                    <motion.div 
                                        key={tx.id || idx}
                                        initial={{ opacity: 0, y: -20 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        className={`flex flex-col p-2 text-xs font-mono border-l-2 ${idx % 2 === 0 ? 'bg-[#0d1825]' : 'bg-[#0a1520]'} 
                                            ${tx.status === 'SETTLED' ? 'border-neonGreen' : tx.status === 'DUPLICATE_DROPPED' ? 'border-amber' : 'border-neonRed'}
                                        `}
                                    >
                                        <div className="flex justify-between items-center text-gray-400 mb-1">
                                            <span>{new Date(tx.settledAt).toLocaleTimeString()}</span>
                                            <span className="text-purple ml-2">{tx.packetHash ? tx.packetHash.substring(0,6) : '??????'}</span>
                                        </div>
                                        <div className="flex justify-between items-center">
                                            <span className="text-white">
                                                {tx.senderId?.split('-')[1] || '?'} → {tx.receiverId?.split('-')[1] || '?'}
                                            </span>
                                            <span className="font-bold text-cyan">₹{tx.amount || 0}</span>
                                        </div>
                                        <div className="mt-1">
                                            <span className={`px-1.5 py-0.5 rounded-sm text-[10px] 
                                                ${tx.status === 'SETTLED' ? 'bg-neonGreen text-black' : tx.status === 'DUPLICATE_DROPPED' ? 'bg-amber text-black' : 'bg-neonRed text-white'}
                                            `}>
                                                {tx.status}
                                            </span>
                                        </div>
                                    </motion.div>
                                )).reverse()}
                            </AnimatePresence>
                        </div>
                    </div>

                </div>
            </main>

            {/* FOOTER */}
            <footer className="mt-8 pt-4 border-t border-bordercolor flex justify-between font-mono text-[10px] text-cyan/70 tracking-widest">
                <span>PACKETS IN MESH: {totalPackets}</span>
                <span>GOSSIP ROUNDS: {gossipRounds}</span>
                <span>BRIDGE UPLOADS: {bridgeUploads}</span>
                <span>SYSTEM ONLINE</span>
            </footer>
        </div>
    );
}

function LandingPage({ onEnter }) {
    return (
        <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, scale: 0.95, filter: "blur(10px)" }}
            transition={{ duration: 0.8 }}
            className="min-h-screen flex flex-col items-center justify-center relative overflow-hidden bg-[#070d14]"
        >
            {/* Background elements */}
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-cyan/10 via-[#070d14] to-[#070d14]"></div>
            <div className="absolute top-0 w-full h-[1px] bg-gradient-to-r from-transparent via-cyan to-transparent opacity-50"></div>
            <div className="absolute bottom-0 w-full h-[1px] bg-gradient-to-r from-transparent via-cyan to-transparent opacity-50"></div>
            <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMSIgY3k9IjEiIHI9IjEiIGZpbGw9InJnYmEoMCwyMjksMjU1LDAuMDUpIi8+PC9zdmc+')] opacity-20"></div>
            
            <div className="z-10 text-center flex flex-col items-center max-w-4xl px-6 relative">
                <motion.div 
                    initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.2, duration: 0.8 }}
                    className="mb-8 w-24 h-24 border border-cyan/40 rounded-full flex items-center justify-center shadow-[0_0_30px_rgba(0,229,255,0.15)] relative"
                >
                    {/* Pulsing ring */}
                    <div className="absolute inset-0 rounded-full border border-cyan/30 animate-ping opacity-20"></div>
                    <span className="text-4xl text-cyan">◈</span>
                </motion.div>
                
                <motion.h1 
                    initial={{ y: 20, opacity: 0, letterSpacing: "1em" }} animate={{ y: 0, opacity: 1, letterSpacing: "0.2em" }} transition={{ delay: 0.4, duration: 1, ease: "easeOut" }}
                    className="text-5xl md:text-7xl font-heading text-transparent bg-clip-text bg-gradient-to-b from-white to-cyan mb-2 drop-shadow-[0_0_20px_rgba(0,229,255,0.5)]"
                >
                    GHOSTPAY
                </motion.h1>
                
                <motion.h2 
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.8, duration: 0.8 }}
                    className="text-lg md:text-xl font-mono text-cyan/80 tracking-[0.2em] mb-12"
                >
                    ZERO-SIGNAL PAYMENT NETWORK
                </motion.h2>
                
                <motion.div 
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.0, duration: 0.8 }}
                    className="flex flex-col sm:flex-row gap-4 sm:gap-8 font-mono text-xs sm:text-sm text-gray-400 mb-16 tracking-wider"
                >
                    <span className="flex items-center gap-2"><div className="w-1.5 h-1.5 bg-neonGreen rounded-full shadow-[0_0_5px_#39ff14]"></div> ENCRYPTED</span>
                    <span className="flex items-center gap-2"><div className="w-1.5 h-1.5 bg-amber rounded-full shadow-[0_0_5px_#ffb800]"></div> MESH-ROUTED</span>
                    <span className="flex items-center gap-2"><div className="w-1.5 h-1.5 bg-purple rounded-full shadow-[0_0_5px_#9d4edd]"></div> TAMPER-PROOF</span>
                </motion.div>
                
                <motion.button 
                    initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.2, duration: 0.8 }}
                    whileHover={{ scale: 1.05, boxShadow: "0 0 25px rgba(0,229,255,0.5)", textShadow: "0 0 8px rgba(0,0,0,1)" }}
                    whileTap={{ scale: 0.95 }}
                    onMouseEnter={() => playSFX('hover')}
                    onClick={() => { playSFX('swoosh'); onEnter(); }}
                    className="px-10 py-3 bg-cyan/5 border-2 border-cyan text-cyan font-heading text-xl tracking-widest hover:bg-cyan hover:text-[#070d14] hover:font-bold transition-all duration-300 relative overflow-hidden group mb-8"
                >
                    {/* Glitch overlay */}
                    <div className="absolute inset-0 bg-white/20 translate-y-[-100%] group-hover:animate-[glitch_0.2s_ease-in-out_forwards]"></div>
                    [ ENTER ]
                </motion.button>

                <motion.div 
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.5, duration: 1 }}
                    className="font-mono text-sm tracking-widest"
                >
                    <span className="text-gray-400">Developed By </span>
                    <strong className="text-cyan font-bold drop-shadow-[0_0_5px_rgba(0,229,255,0.5)]">Mr Rohan Shukla</strong>
                </motion.div>
            </div>
        </motion.div>
    );
}

function ArchitectureScreen({ onProceed }) {
    const [activeStage, setActiveStage] = useState(1);
    const [logs, setLogs] = useState(["SYSTEM BOOT SEQUENCE INITIATED..."]);
    const logRef = useRef(null);

    useEffect(() => {
        const events = [
            { s: 1, text: "> Generating offline payment intent...\n> AES-256 session key generated." },
            { s: 1, text: "> Wrapping AES key with Server RSA Public Key...\n> Packet ready [TTL: 5]." },
            { s: 2, text: "> Bluetooth LE broadcast initiated...\n> Discovered 3 nearby peers." },
            { s: 2, text: "> Gossip protocol: Handing off to MAC a1:b2:c3... [SUCCESS]" },
            { s: 3, text: "> Peer 'phone-bridge' detected 4G cellular signal...\n> Establishing TLS upstream connection." },
            { s: 3, text: "> POST /api/bridge/ingest containing 1 cached payload." },
            { s: 4, text: "> Backend received payload. Validating SHA-256 hash..." },
            { s: 4, text: "> Idempotency CHECK PASSED.\n> RSA Decrypt OK. Signature Valid." },
            { s: 4, text: "> DB Transaction: DEBIT Offline Sender, CREDIT Receiver.\n> SETTLEMENT COMPLETE." }
        ];
        
        let i = 0;
        const interval = setInterval(() => {
            if (i < events.length) {
                const currentText = events[i].text;
                const currentStage = events[i].s;
                setLogs(prev => [...prev, currentText]);
                setActiveStage(currentStage);
                i++;
            } else {
                setLogs(["SYSTEM BOOT SEQUENCE INITIATED..."]);
                setActiveStage(1);
                i = 0;
            }
        }, 1800);
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        if(logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
    }, [logs]);

    return (
        <motion.div 
            initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, y: -50 }}
            transition={{ duration: 0.8 }}
            className="min-h-screen flex flex-col items-center justify-center p-6 sm:p-12 bg-[#070d14] relative overflow-hidden"
        >
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-cyan/10 via-[#070d14] to-[#070d14]"></div>
            
            <motion.h2 
                initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.2 }}
                className="text-2xl sm:text-4xl lg:text-5xl font-heading text-cyan tracking-[0.2em] mb-8 lg:mb-12 drop-shadow-[0_0_10px_rgba(0,229,255,0.4)] relative z-10 text-center uppercase"
            >
                ⬡ REAL-TIME MESH SIMULATION ⬡
            </motion.h2>
            
            <div className="flex flex-col lg:flex-row items-center justify-center gap-4 w-full max-w-6xl relative z-10 font-mono text-sm mb-12">
                
                {/* Stage 1 */}
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }} className={`cyber-card p-4 w-full lg:w-1/4 flex flex-col items-center text-center transition-all duration-500 ${activeStage === 1 ? 'border-cyan shadow-[0_0_30px_rgba(0,229,255,0.3)] bg-[#0d1825]' : 'border-gray-800 bg-[#070d14] opacity-50'}`}>
                    <div className={`w-14 h-14 rounded-full border flex items-center justify-center text-xl mb-3 ${activeStage === 1 ? 'border-cyan text-cyan animate-pulse' : 'border-gray-600 text-gray-500'}`}>📱</div>
                    <h3 className={`font-bold mb-2 tracking-[0.1em] ${activeStage === 1 ? 'text-white' : 'text-gray-500'}`}>OFFLINE SENDER</h3>
                    <p className="text-gray-400 text-[10px] leading-relaxed">Payment wrapped in AES-GCM + RSA Hybrid Encryption.</p>
                </motion.div>
                
                <div className={`text-2xl hidden lg:block transition-colors duration-500 ${activeStage === 1 ? 'text-cyan animate-pulse drop-shadow-[0_0_8px_#00e5ff]' : 'text-gray-800'}`}>➔</div>
                <div className={`rotate-90 lg:hidden py-1 transition-colors duration-500 ${activeStage === 1 ? 'text-cyan animate-pulse drop-shadow-[0_0_8px_#00e5ff]' : 'text-gray-800'}`}>➔</div>

                {/* Stage 2 */}
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6 }} className={`cyber-card p-4 w-full lg:w-1/4 flex flex-col items-center text-center transition-all duration-500 ${activeStage === 2 ? 'border-amber shadow-[0_0_30px_rgba(255,184,0,0.3)] bg-[#0d1825]' : 'border-gray-800 bg-[#070d14] opacity-50'}`}>
                    <div className={`w-14 h-14 rounded-full border flex items-center justify-center text-xl mb-3 relative ${activeStage === 2 ? 'border-amber text-amber' : 'border-gray-600 text-gray-500'}`}>
                        {activeStage === 2 && <span className="absolute inset-0 rounded-full animate-ping border border-amber/50"></span>}◈
                    </div>
                    <h3 className={`font-bold mb-2 tracking-[0.1em] ${activeStage === 2 ? 'text-amber' : 'text-gray-500'}`}>BLUETOOTH MESH</h3>
                    <p className="text-gray-400 text-[10px] leading-relaxed">Opaque ciphertexts hop device-to-device via BLE gossip.</p>
                </motion.div>
                
                <div className={`text-2xl hidden lg:block transition-colors duration-500 ${activeStage === 2 ? 'text-amber animate-pulse drop-shadow-[0_0_8px_#ffb800]' : 'text-gray-800'}`}>➔</div>
                <div className={`rotate-90 lg:hidden py-1 transition-colors duration-500 ${activeStage === 2 ? 'text-amber animate-pulse drop-shadow-[0_0_8px_#ffb800]' : 'text-gray-800'}`}>➔</div>

                {/* Stage 3 */}
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.8 }} className={`cyber-card p-4 w-full lg:w-1/4 flex flex-col items-center text-center transition-all duration-500 ${activeStage === 3 ? 'border-neonGreen shadow-[0_0_30px_rgba(57,255,20,0.3)] bg-[#0d1825]' : 'border-gray-800 bg-[#070d14] opacity-50'}`}>
                    <div className={`w-14 h-14 rounded-full border flex items-center justify-center text-xl mb-3 ${activeStage === 3 ? 'border-neonGreen text-neonGreen shadow-[0_0_15px_#39ff14]' : 'border-gray-600 text-gray-500'}`}>◉</div>
                    <h3 className={`font-bold mb-2 tracking-[0.1em] ${activeStage === 3 ? 'text-neonGreen' : 'text-gray-500'}`}>BRIDGE UPLOAD</h3>
                    <p className="text-gray-400 text-[10px] leading-relaxed">Mesh node gains 4G and pushes cached packets to server.</p>
                </motion.div>
                
                <div className={`text-2xl hidden lg:block transition-colors duration-500 ${activeStage === 3 ? 'text-neonGreen animate-pulse drop-shadow-[0_0_8px_#39ff14]' : 'text-gray-800'}`}>➔</div>
                <div className={`rotate-90 lg:hidden py-1 transition-colors duration-500 ${activeStage === 3 ? 'text-neonGreen animate-pulse drop-shadow-[0_0_8px_#39ff14]' : 'text-gray-800'}`}>➔</div>

                {/* Stage 4 */}
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.0 }} className={`cyber-card p-4 w-full lg:w-1/4 flex flex-col items-center text-center transition-all duration-500 ${activeStage === 4 ? 'border-purple shadow-[0_0_30px_rgba(157,78,221,0.4)] bg-[#0d1825]' : 'border-gray-800 bg-[#070d14] opacity-50'}`}>
                    <div className={`w-14 h-14 rounded-full border flex items-center justify-center text-xl mb-3 ${activeStage === 4 ? 'border-purple text-purple' : 'border-gray-600 text-gray-500'}`}>✦</div>
                    <h3 className={`font-bold mb-2 tracking-[0.1em] ${activeStage === 4 ? 'text-purple' : 'text-gray-500'}`}>SETTLEMENT</h3>
                    <p className="text-gray-400 text-[10px] leading-relaxed">Hash Idempotency → Decrypt → Ledger Execution.</p>
                </motion.div>
                
            </div>

            {/* Simulated Live Log Terminal */}
            <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.2 }} className="w-full max-w-4xl bg-black border border-[#1a3a5c] rounded overflow-hidden relative z-10 font-mono text-xs flex flex-col h-48 shadow-[0_0_20px_rgba(0,0,0,0.8)]">
                <div className="bg-[#0a1520] border-b border-[#1a3a5c] px-3 py-2 flex items-center gap-2 text-[10px] text-gray-500">
                    <div className="flex gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-neonRed"></div><div className="w-2.5 h-2.5 rounded-full bg-amber"></div><div className="w-2.5 h-2.5 rounded-full bg-neonGreen"></div></div>
                    <span className="ml-2 font-bold tracking-widest">TERMINAL // LIVE SIMULATION FEED</span>
                </div>
                <div ref={logRef} className="p-4 flex-grow overflow-y-auto whitespace-pre-wrap text-cyan/80 leading-loose scroll-smooth">
                    {logs.map((l, idx) => (
                        <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} key={idx} className="mb-1">{l}</motion.div>
                    ))}
                    <div className="inline-block w-2 h-4 bg-cyan animate-pulse mt-2">&nbsp;</div>
                </div>
            </motion.div>
            
            <motion.button 
                initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.5, duration: 0.8 }}
                whileHover={{ scale: 1.05, boxShadow: "0 0 30px rgba(0,229,255,0.5)" }}
                whileTap={{ scale: 0.95 }}
                onClick={onProceed}
                className="mt-10 px-10 py-3 bg-cyan/5 border-2 border-cyan text-cyan font-heading text-xl tracking-widest hover:bg-cyan hover:text-[#070d14] hover:font-bold transition-all duration-300 relative z-10"
            >
                [ LAUNCH OPS CENTER ]
            </motion.button>
        </motion.div>
    );
}

function Dashboard() {
    const [step, setStep] = useState(0);
    return (
        <AnimatePresence mode="wait">
            {step === 0 && <LandingPage key="landing" onEnter={() => setStep(1)} />}
            {step === 1 && <ArchitectureScreen key="arch" onProceed={() => setStep(2)} />}
            {step === 2 && <motion.div key="dash" initial={{opacity:0}} animate={{opacity:1}} transition={{duration:0.8}}><OpsDashboard /></motion.div>}
        </AnimatePresence>
    );
}

const root = createRoot(document.getElementById("root"));
root.render(<Dashboard />);
