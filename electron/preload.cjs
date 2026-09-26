const {
    contextBridge,
    ipcRenderer
} = require("electron");

contextBridge.exposeInMainWorld(
    "nodeChatDesktop",
    {
        notify(title, message) {
            ipcRenderer.send(
                "nodechat:notification",
                {
                    title,
                    message
                }
            );
        }
    }
);