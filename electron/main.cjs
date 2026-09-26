const {
    app,
    BrowserWindow,
    shell,
    session
} = require("electron");

const path = require("path");

const WEBSITE_URL =
    "https://node-chat-pyfg.onrender.com";

const APP_ID =
    "com.prashantgdev.nodechat";

let mainWindow = null;

function createWindow() {

    mainWindow = new BrowserWindow({

        width: 1280,
        height: 800,

        minWidth: 900,
        minHeight: 600,

        show: false,

        backgroundColor: "#ffffff",

        title: "NodeChat",

        icon: path.join(
            __dirname,
            "..",
            "public",
            "images",
            "logo.png"
        ),

        webPreferences: {

            contextIsolation: true,

            nodeIntegration: false,

            sandbox: true,

            devTools: true
        }
    });


    /*
     * Show the window only after
     * the first page has loaded.
     */

    mainWindow.once(
        "ready-to-show",
        () => {

            mainWindow.show();

        }
    );


    /*
     * Keep navigation inside NodeChat.
     *
     * External websites are opened
     * using the user's default browser.
     */

    mainWindow.webContents.setWindowOpenHandler(
        ({ url }) => {

            if (
                url.startsWith("https://node-chat-pyfg.onrender.com")
            ) {

                return {
                    action: "allow"
                };

            }

            shell.openExternal(url);

            return {
                action: "deny"
            };
        }
    );


    mainWindow.webContents.on(
        "will-navigate",
        (event, url) => {

            if (
                !url.startsWith(
                    WEBSITE_URL
                )
            ) {

                event.preventDefault();

                shell.openExternal(url);
            }
        }
    );


    /*
     * Load the live NodeChat website.
     */

    mainWindow.loadURL(
        WEBSITE_URL
    );


    /*
     * Open DevTools only during
     * development if needed.
     *
     * Keep this disabled for normal use.
     */

    // mainWindow.webContents.openDevTools();


    mainWindow.on(
        "closed",
        () => {

            mainWindow = null;

        }
    );
}


/*
 * Set the Windows App User Model ID.
 *
 * This is useful for Windows notifications
 * and desktop identity.
 */

if (process.platform === "win32") {

    app.setAppUserModelId(
        APP_ID
    );
}


/*
 * Electron startup.
 */

app.whenReady()
    .then(() => {

        createWindow();

        /*
         * Keep sessions/storage available.
         */

        session.defaultSession
            .setPermissionRequestHandler(
                (webContents, permission, callback) => {

                    /*
                     * Allow common website permissions.
                     *
                     * We can make this more restrictive
                     * later if your website needs it.
                     */

                    const allowedPermissions = [
                        "notifications",
                        "media",
                        "clipboard-read",
                        "clipboard-sanitized-write"
                    ];

                    callback(
                        allowedPermissions.includes(
                            permission
                        )
                    );
                }
            );


        app.on(
            "activate",
            () => {

                if (
                    BrowserWindow.getAllWindows()
                        .length === 0
                ) {

                    createWindow();

                }

            }
        );

    });


/*
 * Windows/Linux:
 * quit when all windows are closed.
 */

app.on(
    "window-all-closed",
    () => {

        if (
            process.platform !== "darwin"
        ) {

            app.quit();

        }

    }
);