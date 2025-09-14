const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const fs = require('fs');
const path = require('path');

class WhatsAppService {
    constructor(mainWindow) {
        this.mainWindow = mainWindow;
        this.client = null;
        this.isReady = false;
        this.shouldStop = false;
        this.isInitialized = false;
    }

    initialize() {
        if (this.isInitialized) {
            this.sendStatus('WhatsApp is already initialized');
            return;
        }

        this.isInitialized = true;
        this.initClient();
    }

    initClient() {
        const sessionPath = path.join(process.cwd(), '.wwebjs_auth');
        
        this.client = new Client({
            authStrategy: new LocalAuth({
                clientId: "egypt-sender",
                dataPath: sessionPath
            }),
            puppeteer: {
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--disable-gpu'
                ]
            }
        });

        this.client.on('qr', async (qr) => {
            console.log('QR Code received');
            
            try {
                const qrDataUrl = await qrcode.toDataURL(qr, {
                    width: 256,
                    margin: 2,
                    color: {
                        dark: '#000000',
                        light: '#FFFFFF'
                    }
                });
                
                this.mainWindow.webContents.send('qr-code', qrDataUrl);
                this.sendStatus('📱 Please scan the QR code with WhatsApp');
            } catch (error) {
                console.error('Error generating QR code:', error);
                this.sendStatus('❌ Error generating QR code');
            }
        });

        this.client.on('authenticated', () => {
            console.log('Authenticated successfully');
            this.sendStatus('✅ Authenticated successfully!');
            this.mainWindow.webContents.send('authenticated');
        });

        this.client.on('ready', () => {
            console.log('WhatsApp client is ready');
            this.isReady = true;
            this.sendStatus('🚀 WhatsApp is ready! You can start sending messages.');
            this.mainWindow.webContents.send('whatsapp-ready');
        });

        this.client.on('auth_failure', (message) => {
            console.error('Authentication failed:', message);
            this.sendStatus('❌ Authentication failed. Please restart the app.');
            this.mainWindow.webContents.send('auth-failed');
            
            const sessionPath = path.join(process.cwd(), '.wwebjs_auth');
            if (fs.existsSync(sessionPath)) {
                fs.rmSync(sessionPath, { recursive: true, force: true });
            }
        });

        this.client.on('disconnected', (reason) => {
            console.log('Disconnected:', reason);
            this.isReady = false;
            this.sendStatus('❌ WhatsApp disconnected: ' + reason);
            this.mainWindow.webContents.send('disconnected');
        });

        console.log('Initializing WhatsApp client...');
        this.sendStatus('🔄 Initializing WhatsApp...');
        
        this.client.initialize().catch(error => {
            console.error('Failed to initialize client:', error);
            this.sendStatus('❌ Failed to initialize WhatsApp. Please restart the app.');
        });
    }

    async startSending(data) {
        const { recipients, message, hasImage, imageData, imageName, imageMimeType, sendWithCaption } = data;
        
        if (!this.isReady) {
            this.sendStatus('⚠️ WhatsApp is not ready yet. Please wait for QR code or connection...');
            return;
        }

        this.shouldStop = false;
        let sent = 0;
        let failed = 0;
        const failedNumbers = [];

        // Prepare media if image is provided
        let media = null;
        if (hasImage && imageData) {
            try {
                // Convert base64 to MessageMedia
                // Remove the data:image/xxx;base64, prefix
                const base64Data = imageData.replace(/^data:image\/\w+;base64,/, '');
                media = new MessageMedia(imageMimeType || 'image/jpeg', base64Data, imageName || 'image.jpg');
                this.sendStatus('📷 Image loaded successfully');
            } catch (error) {
                console.error('Error preparing image:', error);
                this.sendStatus('❌ Error preparing image: ' + error.message);
                return;
            }
        }

        this.sendStatus(`📤 Starting to send ${hasImage ? 'messages with image' : 'messages'} to ${recipients.length} recipients...`);

        for (let i = 0; i < recipients.length; i++) {
            if (this.shouldStop) {
                this.sendStatus('⛔ Stopped by user');
                break;
            }

            const phoneNumber = recipients[i];
            let formattedNumber = phoneNumber.toString().replace(/\D/g, '');
            const chatId = formattedNumber + '@c.us';

            try {
                console.log(`Checking if ${formattedNumber} is on WhatsApp...`);
                
                const isRegistered = await this.client.isRegisteredUser(chatId);
                
                if (!isRegistered) {
                    failed++;
                    failedNumbers.push(phoneNumber);
                    this.sendStatus(`❌ +${phoneNumber} is not on WhatsApp`);
                    this.updateProgress(sent, failed, recipients.length - i - 1);
                    await this.sleep(1000);
                    continue;
                }

                console.log(`Sending to ${formattedNumber}...`);
                
                // Send based on content type
                if (hasImage && media) {
                    if (message && sendWithCaption) {
                        // Send image with caption
                        await this.client.sendMessage(chatId, media, { caption: message });
                        this.sendStatus(`✅ Sent image with caption to +${phoneNumber}`);
                    } else if (message && !sendWithCaption) {
                        // Send message first, then image
                        await this.client.sendMessage(chatId, message);
                        await this.sleep(500); // Small delay between message and image
                        await this.client.sendMessage(chatId, media);
                        this.sendStatus(`✅ Sent message and image to +${phoneNumber}`);
                    } else {
                        // Just send image without caption
                        await this.client.sendMessage(chatId, media);
                        this.sendStatus(`✅ Sent image to +${phoneNumber}`);
                    }
                } else if (message) {
                    // Just send text message
                    await this.client.sendMessage(chatId, message);
                    this.sendStatus(`✅ Sent message to +${phoneNumber}`);
                }
                
                sent++;
                this.updateProgress(sent, failed, recipients.length - i - 1);

                // Add random delay between 3-5 seconds
                if (i < recipients.length - 1) {
                    const delay = 3000 + Math.random() * 2000;
                    this.sendStatus(`⏳ Waiting ${(delay/1000).toFixed(1)} seconds...`);
                    await this.sleep(delay);
                }

            } catch (error) {
                console.error(`Error sending to ${phoneNumber}:`, error);
                failed++;
                failedNumbers.push(phoneNumber);
                this.sendStatus(`❌ Failed to send to +${phoneNumber}: ${error.message}`);
                this.updateProgress(sent, failed, recipients.length - i - 1);
                await this.sleep(2000);
            }
        }

        this.mainWindow.webContents.send('sending-complete', { 
            sent, 
            failed,
            failedNumbers 
        });
        
        this.sendStatus(`✨ Complete! Sent: ${sent}, Failed: ${failed}`);
        
        if (failedNumbers.length > 0) {
            this.sendStatus(`Failed numbers: ${failedNumbers.map(n => '+' + n).join(', ')}`);
        }
    }

    stopSending() {
        this.shouldStop = true;
        this.sendStatus('⏹️ Stopping...');
    }

    sendStatus(message) {
        console.log('Status:', message);
        this.mainWindow.webContents.send('status-update', message);
    }

    updateProgress(sent, failed, remaining) {
        this.mainWindow.webContents.send('progress-update', {
            sent,
            failed,
            remaining
        });
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    destroy() {
        if (this.client) {
            this.client.destroy();
        }
    }
}

module.exports = WhatsAppService;