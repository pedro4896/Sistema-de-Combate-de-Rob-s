import React from "react";
import Robots from "./pages/Robots";
import Bracket from "./pages/Bracket";
import Judge from "./pages/Judge";
import Scores from "./pages/Scores";
import Screen from "./pages/Screen";
import { Trophy, Sword, MonitorPlay, Users, Timer } from "lucide-react";

export default function App() {
  const [tab, setTab] = React.useState<"robots"|"bracket"|"judge"|"scores"|"screen">("robots");
  const Tab = ({ id, icon, label }:{id:any; icon:any; label:string}) => (
    <button onClick={()=>setTab(id)} className={`btn mx-1 ${tab===id?"btn-accent":"bg-arena-card"}`}>
      {icon}<span className="ml-2 hidden sm:inline">{label}</span>
    </button>
  );
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 backdrop-blur bg-black/30 border-b border-white/10">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-2">
          <h1 className="text-xl font-extrabold tracking-widest">ARENA<span className="text-arena-accent">.v3</span></h1>
          <div className="ml-auto flex flex-wrap">
            <Tab id="robots" icon={<Users size={18}/>} label="Robôs" />
            <Tab id="bracket" icon={<Sword size={18}/>} label="Chaveamento" />
            <Tab id="judge" icon={<Timer size={18}/>} label="Luta" />
            <Tab id="scores" icon={<Trophy size={18}/>} label="Pontuação" />
            <Tab id="screen" icon={<MonitorPlay size={18}/>} label="Telão" />
          </div>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-4 py-6">
        {tab==="robots" && <Robots/>}
        {tab==="bracket" && <Bracket/>}
        {tab==="judge" && <Judge/>}
        {tab==="scores" && <Scores/>}
        {tab==="screen" && <Screen/>}
      </main>
    </div>
  );
}
