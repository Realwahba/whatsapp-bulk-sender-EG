const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const WhatsAppService = require('./whatsapp');

// Comprehensive GPU error fixes
app.disableHardwareAcceleration(); // This should be called before app.ready

// Additional GPU-related command line switches
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-dev-shm-usage');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('disable-gpu-vsync');
app.commandLine.appendSwitch('disable-features', 'VizDisplayCompositor');

// Force CPU rasterization as fallback
app.commandLine.appendSwitch('enable-features', 'CpuRasterization');

let mainWindow;
let whatsappService;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 900,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            webSecurity: false,
            // Disable hardware acceleration at window level too
            offscreen: false
        },
        icon: path.join(__dirname, 'icon.png'),
        title: 'WhatsApp Bulk Sender - Egypt',
        // Additional window-level GPU settings
        show: false, // Don't show until ready
        backgroundColor: '#ffffff',
        // Disable transparency effects that might cause GPU issues
        transparent: false,
        hasShadow: true
    });

    // Load the HTML file
    mainWindow.loadFile('index.html');
    
    // Show window when ready to prevent visual glitches
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });
    
    // Initialize WhatsApp service
    whatsappService = new WhatsAppService(mainWindow);
    
    // Remove menu bar
    mainWindow.setMenuBarVisibility(false);
    
    mainWindow.on('closed', () => {
        mainWindow = null;
        if (whatsappService) {
            whatsappService.destroy();
        }
    });

    // When window is ready, initialize WhatsApp
    mainWindow.webContents.on('did-finish-load', () => {
        mainWindow.webContents.send('app-ready');
        whatsappService.initialize();
    });

    // Handle renderer process crashes
    mainWindow.webContents.on('render-process-gone', (event, details) => {
        console.error('Renderer process gone:', details);
        // Optionally restart the app or show an error
    });
}

// Ensure single instance
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        // Someone tried to run a second instance, focus our window instead
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });

    app.whenReady().then(() => {
        createWindow();
    });
}

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (mainWindow === null) {
        createWindow();
    }
});

// Handle GPU process crashes
app.on('gpu-process-crashed', (event, killed) => {
    console.error('GPU process crashed, killed:', killed);
    // The app will continue running without GPU acceleration
});

// IPC Communication - Updated to handle full data object
ipcMain.on('start-sending', (event, data) => {
    whatsappService.startSending(data);
});

ipcMain.on('stop-sending', () => {
    whatsappService.stopSending();
});

ipcMain.on('initialize-whatsapp', () => {
    whatsappService.initialize();
});

// Error handling for uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    // Optionally show a dialog to the user
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});