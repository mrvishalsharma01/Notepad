const { BrowserWindow, globalShortcut, ipcMain, screen } = require('electron');
const path = require('node:path');
const storage = require('../storage');

let mouseEventsIgnored = false;

const DEFAULT_MAIN_WINDOW_SIZE = { width: 800, height: 550 };
const MIN_WINDOW_SIZE = { width: 700, height: 320 };

function createWindow(sendToRenderer, geminiSessionRef) {
    let windowWidth = DEFAULT_MAIN_WINDOW_SIZE.width;
    let windowHeight = DEFAULT_MAIN_WINDOW_SIZE.height;

    const mainWindow = new BrowserWindow({
        width: windowWidth,
        height: windowHeight,
        minWidth: MIN_WINDOW_SIZE.width,
        minHeight: MIN_WINDOW_SIZE.height,
        resizable: true,
        frame: false,
        transparent: true,
        hasShadow: false,
        alwaysOnTop: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false, // TODO: change to true
            backgroundThrottling: false,
            enableBlinkFeatures: 'GetDisplayMedia',
            webSecurity: true,
            allowRunningInsecureContent: false,
        },
        backgroundColor: '#00000000',
    });

    const { session, desktopCapturer } = require('electron');
    session.defaultSession.setDisplayMediaRequestHandler(
        (request, callback) => {
            desktopCapturer.getSources({ types: ['screen'] }).then(sources => {
                callback({ video: sources[0], audio: 'loopback' });
            });
        },
        { useSystemPicker: true }
    );

    mainWindow.setContentProtection(true);
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    // Hide from Windows taskbar
    if (process.platform === 'win32') {
        try {
            mainWindow.setSkipTaskbar(true);
            mainWindow.on('focus', () => {
                mainWindow.setSkipTaskbar(true);
            });
            mainWindow.on('blur', () => {
                mainWindow.setSkipTaskbar(true);
            });
            mainWindow.on('show', () => {
                mainWindow.setSkipTaskbar(true);
            });
        } catch (error) {
            console.warn('Could not hide from taskbar:', error.message);
        }
    }

    // Hide from Mission Control on macOS
    if (process.platform === 'darwin') {
        try {
            mainWindow.setHiddenInMissionControl(true);
        } catch (error) {
            console.warn('Could not hide from Mission Control:', error.message);
        }
    }

    if (process.platform === 'win32') {
        mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
    }

    mainWindow.loadFile(path.join(__dirname, '../index.html'));

    // After window is created, initialize keybinds
    mainWindow.webContents.once('dom-ready', () => {
        setTimeout(() => {
            const defaultKeybinds = getDefaultKeybinds();
            let keybinds = defaultKeybinds;

            // Load keybinds from storage
            const savedKeybinds = storage.getKeybinds();
            if (savedKeybinds) {
                keybinds = { ...defaultKeybinds, ...savedKeybinds };
            }

            updateGlobalShortcuts(keybinds, mainWindow, sendToRenderer, geminiSessionRef);
        }, 150);
    });

    setupWindowIpcHandlers(mainWindow, sendToRenderer, geminiSessionRef);

    return mainWindow;
}

function getDefaultKeybinds() {
    const isMac = process.platform === 'darwin';
    return {
        moveUp: isMac ? 'Alt+Up' : 'Ctrl+Up',
        moveDown: isMac ? 'Alt+Down' : 'Ctrl+Down',
        moveLeft: isMac ? 'Alt+Left' : 'Ctrl+Left',
        moveRight: isMac ? 'Alt+Right' : 'Ctrl+Right',
        toggleVisibility: isMac ? 'Cmd+\\' : 'Ctrl+\\',
        toggleClickThrough: isMac ? 'Cmd+M' : 'Ctrl+M',
        nextStep: isMac ? 'Cmd+Enter' : 'Ctrl+Enter',
        previousResponse: isMac ? 'Cmd+[' : 'Ctrl+[',
        nextResponse: isMac ? 'Cmd+]' : 'Ctrl+]',
        scrollUp: isMac ? 'Cmd+Shift+Up' : 'Ctrl+Shift+Up',
        scrollDown: isMac ? 'Cmd+Shift+Down' : 'Ctrl+Shift+Down',
        emergencyErase: isMac ? 'Cmd+Shift+E' : 'Ctrl+Shift+E',
        increaseTransparency: isMac ? 'Cmd+=' : 'Ctrl+=',
        decreaseTransparency: isMac ? 'Cmd+-' : 'Ctrl+-',
        toggleFocusMode: isMac ? 'Cmd+Shift+F' : 'Ctrl+Shift+F',
    };
}

function updateGlobalShortcuts(keybinds, mainWindow, sendToRenderer, geminiSessionRef) {
    console.log('Updating global shortcuts with:', keybinds);

    // Unregister all existing shortcuts
    globalShortcut.unregisterAll();

    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.workAreaSize;
    const moveIncrement = Math.floor(Math.min(width, height) * 0.1);

    const movementActions = {
        moveUp: () => {
            if (!mainWindow.isVisible()) return;
            const [currentX, currentY] = mainWindow.getPosition();
            mainWindow.setPosition(currentX, currentY - moveIncrement);
        },
        moveDown: () => {
            if (!mainWindow.isVisible()) return;
            const [currentX, currentY] = mainWindow.getPosition();
            mainWindow.setPosition(currentX, currentY + moveIncrement);
        },
        moveLeft: () => {
            if (!mainWindow.isVisible()) return;
            const [currentX, currentY] = mainWindow.getPosition();
            mainWindow.setPosition(currentX - moveIncrement, currentY);
        },
        moveRight: () => {
            if (!mainWindow.isVisible()) return;
            const [currentX, currentY] = mainWindow.getPosition();
            mainWindow.setPosition(currentX + moveIncrement, currentY);
        },
    };

    Object.keys(movementActions).forEach(action => {
        const keybind = keybinds[action];
        if (keybind) {
            try {
                globalShortcut.register(keybind, movementActions[action]);
                console.log(`Registered ${action}: ${keybind}`);
            } catch (error) {
                console.error(`Failed to register ${action} (${keybind}):`, error);
            }
        }
    });

    // Register toggle visibility shortcut
    if (keybinds.toggleVisibility) {
        try {
            globalShortcut.register(keybinds.toggleVisibility, () => {
                if (mainWindow.isVisible()) {
                    mainWindow.hide();
                } else {
                    mainWindow.showInactive();
                }
            });
            console.log(`Registered toggleVisibility: ${keybinds.toggleVisibility}`);
        } catch (error) {
            console.error(`Failed to register toggleVisibility (${keybinds.toggleVisibility}):`, error);
        }
    }

    // Register toggle click-through shortcut
    if (keybinds.toggleClickThrough) {
        try {
            globalShortcut.register(keybinds.toggleClickThrough, () => {
                mouseEventsIgnored = !mouseEventsIgnored;
                if (mouseEventsIgnored) {
                    mainWindow.setIgnoreMouseEvents(true, { forward: true });
                    console.log('Mouse events ignored');
                } else {
                    mainWindow.setIgnoreMouseEvents(false);
                    console.log('Mouse events enabled');
                }
                mainWindow.webContents.send('click-through-toggled', mouseEventsIgnored);
            });
            console.log(`Registered toggleClickThrough: ${keybinds.toggleClickThrough}`);
        } catch (error) {
            console.error(`Failed to register toggleClickThrough (${keybinds.toggleClickThrough}):`, error);
        }
    }

    // Register next step shortcut (either starts session or takes screenshot based on view)
    if (keybinds.nextStep) {
        try {
            globalShortcut.register(keybinds.nextStep, async () => {
                console.log('Next step shortcut triggered');
                try {
                    // Determine the shortcut key format
                    const isMac = process.platform === 'darwin';
                    const shortcutKey = isMac ? 'cmd+enter' : 'ctrl+enter';

                    // Use the new handleShortcut function
                    mainWindow.webContents.executeJavaScript(`
                        cheatingDaddy.handleShortcut('${shortcutKey}');
                    `);
                } catch (error) {
                    console.error('Error handling next step shortcut:', error);
                }
            });
            console.log(`Registered nextStep: ${keybinds.nextStep}`);
        } catch (error) {
            console.error(`Failed to register nextStep (${keybinds.nextStep}):`, error);
        }
    }

    // Register previous response shortcut
    if (keybinds.previousResponse) {
        try {
            globalShortcut.register(keybinds.previousResponse, () => {
                console.log('Previous response shortcut triggered');
                sendToRenderer('navigate-previous-response');
            });
            console.log(`Registered previousResponse: ${keybinds.previousResponse}`);
        } catch (error) {
            console.error(`Failed to register previousResponse (${keybinds.previousResponse}):`, error);
        }
    }

    // Register next response shortcut
    if (keybinds.nextResponse) {
        try {
            globalShortcut.register(keybinds.nextResponse, () => {
                console.log('Next response shortcut triggered');
                sendToRenderer('navigate-next-response');
            });
            console.log(`Registered nextResponse: ${keybinds.nextResponse}`);
        } catch (error) {
            console.error(`Failed to register nextResponse (${keybinds.nextResponse}):`, error);
        }
    }

    // Register scroll up shortcut
    if (keybinds.scrollUp) {
        try {
            globalShortcut.register(keybinds.scrollUp, () => {
                console.log('Scroll up shortcut triggered');
                sendToRenderer('scroll-response-up');
            });
            console.log(`Registered scrollUp: ${keybinds.scrollUp}`);
        } catch (error) {
            console.error(`Failed to register scrollUp (${keybinds.scrollUp}):`, error);
        }
    }

    // Register scroll down shortcut
    if (keybinds.scrollDown) {
        try {
            globalShortcut.register(keybinds.scrollDown, () => {
                console.log('Scroll down shortcut triggered');
                sendToRenderer('scroll-response-down');
            });
            console.log(`Registered scrollDown: ${keybinds.scrollDown}`);
        } catch (error) {
            console.error(`Failed to register scrollDown (${keybinds.scrollDown}):`, error);
        }
    }

    // Register emergency erase shortcut
    if (keybinds.emergencyErase) {
        try {
            globalShortcut.register(keybinds.emergencyErase, () => {
                console.log('Emergency Erase triggered!');
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.hide();

                    if (geminiSessionRef.current) {
                        geminiSessionRef.current.close();
                        geminiSessionRef.current = null;
                    }

                    sendToRenderer('clear-sensitive-data');

                    setTimeout(() => {
                        const { app } = require('electron');
                        app.quit();
                    }, 300);
                }
            });
            console.log(`Registered emergencyErase: ${keybinds.emergencyErase}`);
        } catch (error) {
            console.error(`Failed to register emergencyErase (${keybinds.emergencyErase}):`, error);
        }
    }

    // Register increase transparency shortcut
    if (keybinds.increaseTransparency) {
        const increaseKeys = [keybinds.increaseTransparency, 'Ctrl+Plus', 'Ctrl+=', 'CmdOrCtrl+=', 'CmdOrCtrl+Plus'];
        increaseKeys.forEach(key => {
            try {
                if (globalShortcut.isRegistered(key)) return;
                const success = globalShortcut.register(key, () => {
                    console.log(`Increase transparency shortcut (${key}) triggered`);
                    const prefs = storage.getPreferences();
                    let currentAlpha = prefs.backgroundTransparency ?? 0.8;
                    // Transparency increases -> more see-through -> lower alpha/opacity
                    const newAlpha = Math.max(0.1, parseFloat((currentAlpha - 0.1).toFixed(1)));
                    storage.updatePreference('backgroundTransparency', newAlpha);
                    sendToRenderer('apply-transparency', newAlpha);
                    console.log('New transparency (alpha):', newAlpha);
                });
                require('fs').appendFileSync(
                    path.join(__dirname, '../../shortcut-debug.log'),
                    `increaseTransparency (${key}) registered: ${success}\n`,
                    'utf8'
                );
                console.log(`Registered increaseTransparency (${key}) - Success: ${success}`);
            } catch (error) {
                require('fs').appendFileSync(
                    path.join(__dirname, '../../shortcut-debug.log'),
                    `increaseTransparency (${key}) error: ${error.message}\n`,
                    'utf8'
                );
                console.error(`Failed to register increaseTransparency (${key}):`, error);
            }
        });
    }

    // Register decrease transparency shortcut
    if (keybinds.decreaseTransparency) {
        const decreaseKeys = [keybinds.decreaseTransparency, 'Ctrl+Minus', 'Ctrl+-', 'CmdOrCtrl+-', 'CmdOrCtrl+Minus'];
        decreaseKeys.forEach(key => {
            try {
                if (globalShortcut.isRegistered(key)) return;
                const success = globalShortcut.register(key, () => {
                    console.log(`Decrease transparency shortcut (${key}) triggered`);
                    const prefs = storage.getPreferences();
                    let currentAlpha = prefs.backgroundTransparency ?? 0.8;
                    // Transparency decreases -> less see-through -> higher alpha/opacity
                    const newAlpha = Math.min(1.0, parseFloat((currentAlpha + 0.1).toFixed(1)));
                    storage.updatePreference('backgroundTransparency', newAlpha);
                    sendToRenderer('apply-transparency', newAlpha);
                    console.log('New transparency (alpha):', newAlpha);
                });
                require('fs').appendFileSync(
                    path.join(__dirname, '../../shortcut-debug.log'),
                    `decreaseTransparency (${key}) registered: ${success}\n`,
                    'utf8'
                );
                console.log(`Registered decreaseTransparency (${key}) - Success: ${success}`);
            } catch (error) {
                require('fs').appendFileSync(
                    path.join(__dirname, '../../shortcut-debug.log'),
                    `decreaseTransparency (${key}) error: ${error.message}\n`,
                    'utf8'
                );
                console.error(`Failed to register decreaseTransparency (${key}):`, error);
            }
        });
    }

    // Register toggle focus mode shortcut
    if (keybinds.toggleFocusMode) {
        try {
            globalShortcut.register(keybinds.toggleFocusMode, () => {
                const isFocusable = mainWindow.isFocusable();
                const newFocusable = !isFocusable;
                mainWindow.setFocusable(newFocusable);
                if (process.platform === 'win32') {
                    mainWindow.setSkipTaskbar(true);
                }
                console.log(`Focusable state toggled to: ${newFocusable}`);

                // Save state to preferences
                storage.updatePreference('focusFreeMode', !newFocusable);

                // Notify renderer process to update UI checkbox
                mainWindow.webContents.send('apply-focus-free', !newFocusable);

                // Notify user in the status bar
                sendToRenderer('update-status', newFocusable ? 'Normal Mode' : 'Assessment Mode (Focus-Free)');
            });
            console.log(`Registered toggleFocusMode: ${keybinds.toggleFocusMode}`);
        } catch (error) {
            console.error(`Failed to register toggleFocusMode (${keybinds.toggleFocusMode}):`, error);
        }
    }
}

function setupWindowIpcHandlers(mainWindow, sendToRenderer, geminiSessionRef) {
    ipcMain.on('view-changed', (event, view) => {
        if (!mainWindow.isDestroyed()) {
            if (view !== 'assistant') {
                mainWindow.setIgnoreMouseEvents(false);
                mainWindow.setFocusable(true);
                if (process.platform === 'win32') {
                    mainWindow.setSkipTaskbar(true);
                }
            } else {
                const prefs = storage.getPreferences();
                const focusFree = prefs.focusFreeMode ?? false;
                mainWindow.setFocusable(!focusFree);
                if (process.platform === 'win32') {
                    mainWindow.setSkipTaskbar(true);
                }
                console.log(`Entered assistant view, set focusable to: ${!focusFree}`);
                if (focusFree) {
                    sendToRenderer('update-status', 'Assessment Mode (Focus-Free)');
                }
            }
        }
    });

    ipcMain.handle('window-minimize', () => {
        if (!mainWindow.isDestroyed()) {
            mainWindow.minimize();
        }
    });

    ipcMain.on('update-keybinds', (event, newKeybinds) => {
        if (!mainWindow.isDestroyed()) {
            updateGlobalShortcuts(newKeybinds, mainWindow, sendToRenderer, geminiSessionRef);
        }
    });

    ipcMain.handle('toggle-window-visibility', async event => {
        try {
            if (mainWindow.isDestroyed()) {
                return { success: false, error: 'Window has been destroyed' };
            }

            if (mainWindow.isVisible()) {
                mainWindow.hide();
            } else {
                mainWindow.showInactive();
            }
            return { success: true };
        } catch (error) {
            console.error('Error toggling window visibility:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('get-window-bounds', () => {
        if (!mainWindow.isDestroyed()) {
            return mainWindow.getBounds();
        }
        return { width: 0, height: 0 };
    });

    ipcMain.on('window-resize', (event, { width, height }) => {
        if (!mainWindow.isDestroyed()) {
            mainWindow.setSize(width, height);
        }
    });
}

module.exports = {
    createWindow,
    getDefaultKeybinds,
    updateGlobalShortcuts,
    setupWindowIpcHandlers,
};
