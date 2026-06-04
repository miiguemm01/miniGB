const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("miniGb", {
    getInitialFrame() {
        return ipcRenderer.invoke("emulator:get-initial-frame");
    },
    onFrame(listener) {
        const wrapped = (_event, payload) => {
            listener(payload);
        };

        ipcRenderer.on("emulator:frame", wrapped);
        return () => {
            ipcRenderer.removeListener("emulator:frame", wrapped);
        };
    },
    setJoypadButton(button, pressed) {
        return ipcRenderer.invoke("emulator:input", { button, pressed });
    },
    setSpeedMultiplier(multiplier) {
        return ipcRenderer.invoke("emulator:speed", multiplier);
    },
    saveState(action) {
        return ipcRenderer.invoke("emulator:savestate", action);
    },
});
