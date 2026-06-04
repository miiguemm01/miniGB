import { basename, join } from "path";
import { app, BrowserWindow, Menu, dialog, ipcMain } from "electron";
import { JoypadButton } from "../hardware/memory";
import { MiniGbSession } from "../emulator/session";
import { SaveStateAction } from "../emulator/types";

function resolveRomPath(argv: string[]): string | null {
    return argv[2] ?? null;
}

const activeRomPath = resolveRomPath(process.argv);

const session = new MiniGbSession({
    romPath: activeRomPath,
    hardwareModel: "cgb",
    loadFromSnapshot: false,
});

let mainWindow: InstanceType<typeof BrowserWindow> | null = null;

function relaunchWithRom(romPath: string): void {
    app.relaunch({
        args: [app.getAppPath(), romPath],
    });
    app.exit(0);
}

async function openRomFromMenu(): Promise<void> {
    const dialogOptions: Electron.OpenDialogOptions = {
        title: "Open ROM",
        properties: ["openFile"],
        filters: [
            {
                name: "Game Boy ROMs",
                extensions: ["gb", "gbc", "rom", "bin"],
            },
            {
                name: "All files",
                extensions: ["*"],
            },
        ],
    };
    const result = mainWindow
        ? await dialog.showOpenDialog(mainWindow, dialogOptions)
        : await dialog.showOpenDialog(dialogOptions);

    if (result.canceled || result.filePaths.length === 0) {
        return;
    }

    relaunchWithRom(result.filePaths[0]);
}

function installApplicationMenu(): void {
    const template: Electron.MenuItemConstructorOptions[] = [
        {
            label: "File",
            submenu: [
                {
                    label: "Open ROM...",
                    accelerator: "CmdOrCtrl+O",
                    click: () => {
                        void openRomFromMenu();
                    },
                },
                {
                    label: activeRomPath
                        ? `Current ROM: ${basename(activeRomPath)}`
                        : "Current ROM: none",
                    enabled: false,
                },
                { type: "separator" },
                {
                    label: "Quit",
                    accelerator: "CmdOrCtrl+Q",
                    click: () => {
                        app.quit();
                    },
                },
            ],
        },
    ];

    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow(): void {
    const appPath = app.getAppPath();

    mainWindow = new BrowserWindow({
        width: 1440,
        height: 980,
        minWidth: 1120,
        minHeight: 760,
        backgroundColor: "#12100f",
        title: "miniGB",
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            preload: join(appPath, "src", "electron", "preload.js"),
        },
    });

    mainWindow.loadFile(join(appPath, "src", "ui", "index.html"));

    mainWindow.on("closed", () => {
        mainWindow = null;
    });
}

app.whenReady().then(() => {
    const unsubscribe = session.subscribe((payload) => {
        mainWindow?.webContents.send("emulator:frame", payload);
    });

    installApplicationMenu();
    createWindow();
    session.start();

    const romInfo = session.getRomInfo();
    console.log("miniGB Electron ready");
    if (romInfo.romPath) {
        console.log(`ROM loaded from ${romInfo.romPath} (${romInfo.byteLength} bytes)`);
        console.log(`savestate path: ${romInfo.saveStatePath}`);
        console.log(`snapshot path: ${romInfo.snapshotPath}`);
    } else {
        console.log("No ROM loaded. Use File > Open ROM... to start one.");
    }

    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });

    app.on("window-all-closed", () => {
        unsubscribe();
        app.quit();
    });
});

ipcMain.handle("emulator:get-initial-frame", () => {
    return session.getCurrentFramePayload(true);
});

ipcMain.handle("emulator:input", (_event: unknown, payload: { button: JoypadButton; pressed: boolean }) => {
    session.setJoypadButton(payload.button, payload.pressed);
});

ipcMain.handle("emulator:speed", (_event: unknown, multiplier: number) => {
    return session.setSpeedMultiplier(multiplier);
});

ipcMain.handle("emulator:savestate", (_event: unknown, action: SaveStateAction) => {
    return session.handleSaveStateAction(action);
});
