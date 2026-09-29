"use strict";

const KeyboardGuide = {
  rows: [
    ["Escape","1","2","3","4","5","6","7","8","9","0","-","=","Backspace"],
    ["Tab","KeyQ","KeyW","KeyE","KeyR","KeyT","KeyY","KeyU","KeyI","KeyO","KeyP","[","]","\\"],
    ["CapsLock","KeyA","KeyS","KeyD","KeyF","KeyG","KeyH","KeyJ","KeyK","KeyL",";","'","Enter"],
    ["ShiftLeft","KeyZ","KeyX","KeyC","KeyV","KeyB","KeyN","KeyM",",",".","/","ShiftRight"],
    ["ControlLeft","MetaLeft","AltLeft","Space","AltRight","MetaRight","ControlRight"]
  ],
  descriptions: {
    forward: "Move forward", backward: "Move backward", left: "Move left", right: "Move right",
    sprint: "Sprint", crouch: "Crouch", jump: "Jump", flashlight: "Flashlight", inventory: "Inventory",
    drink: "Drink Almond Water", use: "Pick up / interact", nearestExit: "Nearest exit",
    regenerate: "New layout", unlockMouse: "Unlock mouse"
  },
  open() {
    const el=document.getElementById("keyboard-guide-overlay");
    if(!el)return;
    this.render(); el.style.display="flex";
  },
  close(){const el=document.getElementById("keyboard-guide-overlay");if(el)el.style.display="none";},
  format(code){
    const m={Space:"SPACE",Escape:"ESC",Backspace:"BACKSPACE",Tab:"TAB",Enter:"ENTER",CapsLock:"CAPS",ShiftLeft:"SHIFT",ShiftRight:"SHIFT",ControlLeft:"CTRL",ControlRight:"CTRL",AltLeft:"ALT",AltRight:"ALT",MetaLeft:"META",MetaRight:"META"};
    if(m[code])return m[code];
    if(code.startsWith("Key"))return code.slice(3);
    if(code.startsWith("Digit"))return code.slice(5);
    return code;
  },
  render(){
    const root=document.getElementById("keyboard-guide"); if(!root)return;
    const bindings={};
    for(const [action,label] of Object.entries(this.descriptions)){
      const code=CONFIG.keys[action]; if(code) bindings[code]=label;
    }
    root.innerHTML="";
    for(const row of this.rows){
      const rowEl=document.createElement("div"); rowEl.className="keyboard-row";
      for(const code of row){
        const key=document.createElement("div"); key.className="keyboard-key";
        if(bindings[code]) key.classList.add("game-key");
        if(code==="KeyW"||code==="KeyA"||code==="KeyS"||code==="KeyD") key.classList.add("movement-key");
        key.textContent=this.format(code);
        if(bindings[code]){
          const label=document.createElement("span"); label.className="keyboard-key-label"; label.textContent=bindings[code]; key.appendChild(label);
          key.title=bindings[code];
        }
        rowEl.appendChild(key);
      }
      root.appendChild(rowEl);
    }
    const legend=document.getElementById("keyboard-guide-legend");
    if(legend){
      legend.innerHTML="";
      for(const [action,label] of Object.entries(this.descriptions)){
        const code=CONFIG.keys[action]; if(!code)continue;
        const item=document.createElement("div"); item.className="keyboard-legend-item";
        item.innerHTML=`<kbd>${this.format(code)}</kbd><span>${label}</span>`; legend.appendChild(item);
      }
    }
  }
};
window.addEventListener("keydown",e=>{if(e.code==="Escape"&&document.getElementById("keyboard-guide-overlay")?.style.display==="flex"){e.preventDefault();KeyboardGuide.close();}},true);
window.addEventListener("load",()=>{
  const b=document.getElementById("keyboard-guide-close"); if(b)b.addEventListener("click",()=>KeyboardGuide.close());
});
