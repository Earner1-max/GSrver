// index.js - Main Cloudflare Worker entry point

import { Telegraf, Markup, session } from 'telegraf';
import QRCode from 'qrcode';
import * as db from './database.js';
import * as ox from './oxapay.js';
import {
    BOT_TOKEN,
    ADMIN_ID,
    REQUIRED_CHANNELS,
    GTC_PRICE_USDT,
    PRESALE_GTC_REWARD,
    PRESALE_PRICE_USDT,
    TGE_PRICE_USDT,
    TGE_WITHDRAWAL_PERCENT,
    PRESALE_WITHDRAWAL_PERCENT,
    WEBHOOK_PATH,
    logger,
    DEFAULT_REFER_AMOUNT,
    DEFAULT_MINE_AMOUNT,
    DEFAULT_MIN_WITHDRAWAL,
    DEFAULT_MINE_COOLDOWN
} from './config.js';

// Conversation states
const ONBOARD_EMOJI = 'ONBOARD_EMOJI';
const ONBOARD_CHANNELS = 'ONBOARD_CHANNELS';
const ONBOARD_COMMENT = 'ONBOARD_COMMENT';
const ONBOARD_SCREENSHOT = 'ONBOARD_SCREENSHOT';

const ROCKET = '🚀';
const ALL_EMOJIS = ['🚀', '🌙', '⭐', '💎', '🔥', '💰', '🎯', '⚡', '🎁'];

// Global bot instance
let bot = null;

/**
 * Initialize the bot
 */
function initializeBot() {
    if (!BOT_TOKEN) {
        throw new Error('BOT_TOKEN is not set');
    }
    
    bot = new Telegraf(BOT_TOKEN);
    
    // Session middleware
    bot.use(session());
    
    // Setup all handlers
    setupHandlers();
    
    logger.info('Bot initialized successfully');
    return bot;
}

/**
 * Setup all bot handlers
 */
function setupHandlers() {
    // Start command
    bot.start(handleStart);
    
    // Verify command
    bot.command('verify', handleVerify);
    
    // Admin commands
    bot.command('admin', handleAdminPanel);
    
    // Emoji verification
    bot.action(/ob_emoji_(.+)/, handleEmojiVerification);
    
    // Channel verification
    bot.action('ob_verify_ch', handleChannelVerification);
    
    // Screenshot submission
    bot.on('photo', handleScreenshot);
    
    // Main menu buttons
    bot.hears('💰 Balance', handleBalance);
    bot.hears('👥 Refer', handleRefer);
    bot.hears('⛏️ Mine', handleMine);
    bot.hears('💸 Withdrawal', handleWithdrawal);
    bot.hears('👤 Profile', handleProfile);
    
    // Admin menu buttons
    bot.hears('📋 Pending TGE', handlePendingTGE);
    bot.hears('📋 Pending Presale', handlePendingPresale);
    bot.hears('💸 Withdrawals', handleWithdrawalsAdmin);
    bot.hears('📢 Announce', handleAnnounce);
    bot.hears('📊 Distribution', handleDistribution);
    bot.hears('⚙️ Settings', handleSettings);
    bot.hears('🏠 Main Menu', handleMainMenu);
}

// ────────────────────────────────────────────────────────────────────────────────
// HANDLERS
// ────────────────────────────────────────────────────────────────────────────────

/**
 * Handle /start command
 */
async function handleStart(ctx) {
    try {
        const user = ctx.from;
        const args = ctx.startPayload;
        
        let referredBy = null;
        if (args) {
            try {
                const ref = parseInt(args);
                if (!isNaN(ref) && ref !== user.id) {
                    referredBy = ref;
                }
            } catch (e) {}
        }
        
        let userData = await db.getUser(user.id);
        if (!userData) {
            await db.createUser(
                user.id,
                user.username || '',
                `${user.first_name} ${user.last_name || ''}`.trim(),
                referredBy
            );
        }
        
        userData = await db.getUser(user.id);
        if (userData && userData.verified) {
            await ctx.replyWithMarkdown(
                `👋 Welcome back, *${user.first_name}*!\nUse the menu below.`,
                mainKb()
            );
            ctx.session = null;
            return;
        }
        
        await sendEmojiStep(ctx);
        ctx.session = { state: ONBOARD_EMOJI };
    } catch (error) {
        logger.error(`handleStart error: ${error.message}`);
        await ctx.reply('❌ An error occurred. Please try again.');
    }
}

/**
 * Handle /verify command
 */
async function handleVerify(ctx) {
    try {
        let userData = await db.getUser(ctx.from.id);
        
        if (userData && userData.verified) {
            await ctx.replyWithMarkdown(
                '✅ *Verification Successful!*\n\nWelcome to GTC Mining. Use the panel below.',
                mainKb()
            );
            ctx.session = null;
            return;
        }
        
        if (!userData) {
            await db.createUser(
                ctx.from.id,
                ctx.from.username || '',
                `${ctx.from.first_name} ${ctx.from.last_name || ''}`.trim()
            );
        }
        
        await sendEmojiStep(ctx);
        ctx.session = { state: ONBOARD_EMOJI };
    } catch (error) {
        logger.error(`handleVerify error: ${error.message}`);
        await ctx.reply('❌ An error occurred. Please try again.');
    }
}

/**
 * Handle admin panel access
 */
async function handleAdminPanel(ctx) {
    try {
        if (ctx.from.id !== ADMIN_ID) {
            await ctx.reply('❌ You are not authorized to use this command.');
            return;
        }
        
        const stats = await db.getDistributionStats();
        const message = `
📊 *Admin Panel*

Total Users: ${stats.total_users}
Verified: ${stats.verified}
Total Balance: ${stats.total_balance.toFixed(0)} GTC
TGE Users: ${stats.tge_users}
Presale Users: ${stats.presale_users}
Pending Withdrawals: ${stats.pending_wd}
Mined Today: ${stats.mine_today}

Use the buttons below to manage requests.
        `;
        
        await ctx.replyWithMarkdown(message, adminKb());
        ctx.session = { admin: true };
    } catch (error) {
        logger.error(`handleAdminPanel error: ${error.message}`);
        await ctx.reply('❌ An error occurred.');
    }
}

/**
 * Handle emoji verification step
 */
async function handleEmojiVerification(ctx) {
    try {
        const chosen = ctx.match[1];
        
        if (chosen !== ROCKET) {
            await ctx.answerCbQuery('❌ Wrong! Find the 🚀 Rocket.', { show_alert: true });
            const emojis = [...ALL_EMOJIS].sort(() => Math.random() - 0.5);
            const rows = [];
            for (let i = 0; i < 9; i += 3) {
                rows.push(emojis.slice(i, i + 3).map(e => Markup.button.callback(e, `ob_emoji_${e}`)));
            }
            await ctx.editMessageReplyMarkup(Markup.inlineKeyboard(rows).reply_markup);
            return;
        }
        
        await ctx.answerCbQuery();
        await ctx.editMessageText('✅ Verified! Now join our communities 👇');
        await ctx.replyWithMarkdown(
            '📢 *Join All Our Channels*\n\nYou must join all to continue.\nAfter joining, tap ✅ Verify below.',
            channelsKeyboard()
        );
        ctx.session.state = ONBOARD_CHANNELS;
    } catch (error) {
        logger.error(`handleEmojiVerification error: ${error.message}`);
        await ctx.reply('❌ An error occurred.');
    }
}

/**
 * Handle channel verification
 */
async function handleChannelVerification(ctx) {
    try {
        await ctx.answerCbQuery('🔄 Checking membership…');
        const userId = ctx.from.id;
        
        for (const ch of REQUIRED_CHANNELS) {
            if (ch.verifiable && ch.tg_id) {
                const joined = await isMember(ctx, userId, ch.tg_id);
                if (!joined) {
                    await ctx.answerCbQuery(
                        `❌ You haven't joined ${ch.name} yet!\nPlease join and try again.`,
                        { show_alert: true }
                    );
                    await ctx.editMessageReplyMarkup(channelsKeyboard().reply_markup);
                    return;
                }
            }
        }
        
        await ctx.editMessageText('✅ All channels joined!');
        await sendCommentStep(ctx.chat.id, ctx);
        ctx.session.state = ONBOARD_COMMENT;
    } catch (error) {
        logger.error(`handleChannelVerification error: ${error.message}`);
        await ctx.reply('❌ An error occurred.');
    }
}

/**
 * Handle screenshot submission
 */
async function handleScreenshot(ctx) {
    try {
        if (ctx.session?.state !== ONBOARD_SCREENSHOT) {
            return;
        }
        
        const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
        const userId = ctx.from.id;
        
        await db.saveScreenshot(userId, fileId);
        await db.updateUser(userId, { verified: 1 });
        
        await ctx.replyWithMarkdown(
            '✅ *Verification Successful!*\n\nWelcome to GTC Mining. Use the panel below.',
            mainKb()
        );
        
        ctx.session = null;
    } catch (error) {
        logger.error(`handleScreenshot error: ${error.message}`);
        await ctx.reply('❌ An error occurred.');
    }
}

/**
 * Handle balance request
 */
async function handleBalance(ctx) {
    try {
        const userData = await db.getUser(ctx.from.id);
        if (!userData) {
            await ctx.reply('❌ User not found.');
            return;
        }
        
        const balance = userData.balance;
        const usdt = (balance * GTC_PRICE_USDT).toFixed(2);
        
        await ctx.replyWithMarkdown(
            `💰 *Your Balance*\n\n${formatGtcUsdt(balance)}\n\nEarn more by mining, referring, or completing tasks!`,
            mainKb()
        );
    } catch (error) {
        logger.error(`handleBalance error: ${error.message}`);
        await ctx.reply('❌ An error occurred.');
    }
}

/**
 * Handle referral request
 */
async function handleRefer(ctx) {
    try {
        const userData = await db.getUser(ctx.from.id);
        if (!userData) {
            await ctx.reply('❌ User not found.');
            return;
        }
        
        const refLink = `https://t.me/YourBotUsername?start=${ctx.from.id}`;
        const reward = DEFAULT_REFER_AMOUNT;
        
        await ctx.replyWithMarkdown(
            `👥 *Referral Program*\n\nYour Link: \`${refLink}\`\n\n` +
            `Get *${reward} GTC* for each referral!\n` +
            `Current Referrals: ${userData.referral_count}`,
            mainKb()
        );
    } catch (error) {
        logger.error(`handleRefer error: ${error.message}`);
        await ctx.reply('❌ An error occurred.');
    }
}

/**
 * Handle mining
 */
async function handleMine(ctx) {
    try {
        const userData = await db.getUser(ctx.from.id);
        if (!userData) {
            await ctx.reply('❌ User not found.');
            return;
        }
        
        const now = Math.floor(Date.now() / 1000);
        const lastMine = userData.last_mine || 0;
        const cooldown = DEFAULT_MINE_COOLDOWN;
        
        if (now - lastMine < cooldown) {
            const waitTime = cooldown - (now - lastMine);
            const hours = Math.floor(waitTime / 3600);
            const minutes = Math.floor((waitTime % 3600) / 60);
            
            await ctx.replyWithMarkdown(
                `⛏️ *Mining*\n\n⏳ Please wait ${hours}h ${minutes}m before mining again.`,
                mainKb()
            );
            return;
        }
        
        const amount = DEFAULT_MINE_AMOUNT;
        await db.addBalance(ctx.from.id, amount);
        await db.updateUser(ctx.from.id, { last_mine: now });
        
        await ctx.replyWithMarkdown(
            `⛏️ *Mining Successful!*\n\n` +
            `You earned ${formatEarn(amount)}\n\n` +
            `Come back in 24 hours to mine again!`,
            mainKb()
        );
    } catch (error) {
        logger.error(`handleMine error: ${error.message}`);
        await ctx.reply('❌ An error occurred.');
    }
}

/**
 * Handle withdrawal request
 */
async function handleWithdrawal(ctx) {
    try {
        const userData = await db.getUser(ctx.from.id);
        if (!userData) {
            await ctx.reply('❌ User not found.');
            return;
        }
        
        const minWithdrawal = DEFAULT_MIN_WITHDRAWAL;
        if (userData.balance < minWithdrawal) {
            await ctx.replyWithMarkdown(
                `💸 *Insufficient Balance*\n\n` +
                `Minimum Withdrawal: ${formatGtcUsdt(minWithdrawal)}\n` +
                `Your Balance: ${formatGtcUsdt(userData.balance)}`,
                mainKb()
            );
            return;
        }
        
        ctx.session = { state: 'WITHDRAWAL_ADDRESS', user_id: ctx.from.id };
        await ctx.replyWithMarkdown('💸 *Withdrawal*\n\nEnter your BNB address:');
    } catch (error) {
        logger.error(`handleWithdrawal error: ${error.message}`);
        await ctx.reply('❌ An error occurred.');
    }
}

/**
 * Handle profile request
 */
async function handleProfile(ctx) {
    try {
        const userData = await db.getUser(ctx.from.id);
        if (!userData) {
            await ctx.reply('❌ User not found.');
            return;
        }
        
        const joinedDate = new Date(userData.joined_at * 1000).toLocaleDateString();
        
        await ctx.replyWithMarkdown(
            `👤 *Your Profile*\n\n` +
            `ID: \`${userData.user_id}\`\n` +
            `Username: @${userData.username || 'N/A'}\n` +
            `Full Name: ${userData.full_name || 'N/A'}\n` +
            `Balance: ${formatGtcUsdt(userData.balance)}\n` +
            `Referrals: ${userData.referral_count}\n` +
            `Verified: ${userData.verified ? '✅ Yes' : '❌ No'}\n` +
            `Joined: ${joinedDate}`,
            mainKb()
        );
    } catch (error) {
        logger.error(`handleProfile error: ${error.message}`);
        await ctx.reply('❌ An error occurred.');
    }
}

/**
 * Handle pending TGE requests (admin only)
 */
async function handlePendingTGE(ctx) {
    try {
        if (ctx.from.id !== ADMIN_ID) {
            return;
        }
        
        const requests = await db.getPendingTgeRequests();
        if (requests.length === 0) {
            await ctx.reply('No pending TGE requests.');
            return;
        }
        
        let message = '📋 *Pending TGE Requests*\n\n';
        for (const req of requests) {
            message += `ID: ${req.id}\nUser: ${req.username || req.full_name}\nBalance: ${req.balance}\n\n`;
        }
        
        await ctx.replyWithMarkdown(message);
    } catch (error) {
        logger.error(`handlePendingTGE error: ${error.message}`);
        await ctx.reply('❌ An error occurred.');
    }
}

/**
 * Handle pending presale requests (admin only)
 */
async function handlePendingPresale(ctx) {
    try {
        if (ctx.from.id !== ADMIN_ID) {
            return;
        }
        
        const requests = await db.getPendingPresaleRequests();
        if (requests.length === 0) {
            await ctx.reply('No pending presale requests.');
            return;
        }
        
        let message = '📋 *Pending Presale Requests*\n\n';
        for (const req of requests) {
            message += `ID: ${req.id}\nUser: ${req.username || req.full_name}\n\n`;
        }
        
        await ctx.replyWithMarkdown(message);
    } catch (error) {
        logger.error(`handlePendingPresale error: ${error.message}`);
        await ctx.reply('❌ An error occurred.');
    }
}

/**
 * Handle withdrawals admin view
 */
async function handleWithdrawalsAdmin(ctx) {
    try {
        if (ctx.from.id !== ADMIN_ID) {
            return;
        }
        
        const withdrawals = await db.getPendingWithdrawals();
        if (withdrawals.length === 0) {
            await ctx.reply('No pending withdrawals.');
            return;
        }
        
        let message = '💸 *Pending Withdrawals*\n\n';
        for (const wd of withdrawals) {
            message += `ID: ${wd.id}\nUser: ${wd.username || wd.full_name}\nAmount: ${wd.amount_gtc} GTC\nAddress: ${wd.bnb_address}\n\n`;
        }
        
        await ctx.replyWithMarkdown(message);
    } catch (error) {
        logger.error(`handleWithdrawalsAdmin error: ${error.message}`);
        await ctx.reply('❌ An error occurred.');
    }
}

/**
 * Handle announcement
 */
async function handleAnnounce(ctx) {
    try {
        if (ctx.from.id !== ADMIN_ID) {
            return;
        }
        ctx.session = { state: 'ANNOUNCE' };
        await ctx.reply('📢 Enter announcement message:');
    } catch (error) {
        logger.error(`handleAnnounce error: ${error.message}`);
    }
}

/**
 * Handle distribution stats
 */
async function handleDistribution(ctx) {
    try {
        if (ctx.from.id !== ADMIN_ID) {
            return;
        }
        
        const stats = await db.getDistributionStats();
        const message = `
📊 *Distribution Stats*

Total Users: ${stats.total_users}
Verified Users: ${stats.verified}
Total Balance: ${stats.total_balance.toFixed(0)} GTC
TGE Users: ${stats.tge_users}
Presale Users: ${stats.presale_users}
Presale Rewarded: ${stats.presale_rewarded}
Mined Today: ${stats.mine_today}
Pending Withdrawals: ${stats.pending_wd}
        `;
        
        await ctx.replyWithMarkdown(message, adminKb());
    } catch (error) {
        logger.error(`handleDistribution error: ${error.message}`);
        await ctx.reply('❌ An error occurred.');
    }
}

/**
 * Handle settings
 */
async function handleSettings(ctx) {
    try {
        if (ctx.from.id !== ADMIN_ID) {
            return;
        }
        
        const settings = {
            refer_amount: await db.getSetting('refer_amount'),
            mine_amount: await db.getSetting('mine_amount'),
            min_withdrawal: await db.getSetting('min_withdrawal'),
            mine_cooldown: await db.getSetting('mine_cooldown'),
        };
        
        const message = `
⚙️ *Current Settings*

Refer Amount: ${settings.refer_amount} GTC
Mine Amount: ${settings.mine_amount} GTC
Min Withdrawal: ${settings.min_withdrawal} GTC
Mine Cooldown: ${settings.mine_cooldown}s
        `;
        
        await ctx.replyWithMarkdown(message, adminKb());
    } catch (error) {
        logger.error(`handleSettings error: ${error.message}`);
        await ctx.reply('❌ An error occurred.');
    }
}

/**
 * Handle main menu
 */
async function handleMainMenu(ctx) {
    try {
        await ctx.replyWithMarkdown('🏠 *Main Menu*\n\nSelect an option:', mainKb());
    } catch (error) {
        logger.error(`handleMainMenu error: ${error.message}`);
    }
}

// ────────────────────────────────────────────────────────────────────────────────
// HELPER FUNCTIONS
// ────────────────────────────────────────────────────────────────────────────────

/**
 * Format GTC to USDT display
 */
function formatGtcUsdt(gtc) {
    const formattedGtc = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(gtc);
    const formattedUsdt = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(gtc * GTC_PRICE_USDT);
    return `\`${formattedGtc} GTC\` ≈ \`$${formattedUsdt} USDT\``;
}

/**
 * Format earnings display
 */
function formatEarn(gtc) {
    const formattedGtc = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(gtc);
    const formattedUsdt = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(gtc * GTC_PRICE_USDT);
    return `*${formattedGtc} GTC* ≈ \`$${formattedUsdt} USDT\``;
}

/**
 * Main menu keyboard
 */
function mainKb() {
    return Markup.keyboard([
        ['💰 Balance', '👥 Refer'],
        ['⛏️ Mine', '💸 Withdrawal'],
        ['👤 Profile']
    ]).resize();
}

/**
 * Admin menu keyboard
 */
function adminKb() {
    return Markup.keyboard([
        ['📋 Pending TGE', '📋 Pending Presale'],
        ['💸 Withdrawals', '📢 Announce'],
        ['📊 Distribution', '⚙️ Settings'],
        ['🏠 Main Menu']
    ]).resize();
}

/**
 * Channels keyboard
 */
function channelsKeyboard(extraButton = true) {
    const rows = REQUIRED_CHANNELS.map(ch => [Markup.button.url(ch.name, ch.url)]);
    if (extraButton) {
        rows.push([Markup.button.callback("✅ I've Joined All — Verify", 'ob_verify_ch')]);
    }
    return Markup.inlineKeyboard(rows);
}

/**
 * Check if user is member of channel
 */
async function isMember(ctx, userId, tgId) {
    try {
        const member = await ctx.telegram.getChatMember(tgId, userId);
        return ['member', 'administrator', 'creator'].includes(member.status);
    } catch (error) {
        logger.error(`isMember error: ${error.message}`);
        return false;
    }
}

/**
 * Send emoji verification step
 */
async function sendEmojiStep(ctx) {
    const emojis = [...ALL_EMOJIS].sort(() => Math.random() - 0.5);
    const rows = [];
    for (let i = 0; i < 9; i += 3) {
        rows.push(emojis.slice(i, i + 3).map(e => Markup.button.callback(e, `ob_emoji_${e}`)));
    }
    await ctx.replyWithMarkdown(
        '🔐 *Anti-Bot Verification*\n\nTap the *🚀 Rocket* emoji to continue!',
        Markup.inlineKeyboard(rows)
    );
}

/**
 * Send comment verification step
 */
async function sendCommentStep(chatId, ctx) {
    const postUrl = await db.getSetting('comment_post_url') || 'https://x.com';
    await ctx.telegram.sendMessage(
        chatId,
        '📝 *Comment Task*\n\n' +
        `Reply to this post: ${postUrl}\n\n` +
        'Send a screenshot of your comment reply to continue.'
    );
}

// ────────────────────────────────────────────────────────────────────────────────
// CLOUDFLARE WORKER ENTRY POINT
// ────────────────────────────────────────────────────────────────────────────────

export default {
    async fetch(request, env, ctx) {
        try {
            // Initialize environment variables and database
            injectEnvironment(env);
            db.initDatabase(env.DB);
            
            // Initialize database tables
            await db.initDb();
            
            // Initialize bot if not already done
            if (!bot) {
                bot = initializeBot();
            }
            
            // Handle webhook request
            if (request.method === 'POST' && request.url.includes(WEBHOOK_PATH)) {
                const update = await request.json();
                
                try {
                    await bot.handleUpdate(update);
                } catch (error) {
                    logger.error(`Update handling error: ${error.message}`);
                }
                
                return new Response(JSON.stringify({ ok: true }), {
                    headers: { 'Content-Type': 'application/json' }
                });
            }
            
            // Health check endpoint
            if (request.url.includes('/health')) {
                return new Response(JSON.stringify({ status: 'ok' }), {
                    headers: { 'Content-Type': 'application/json' }
                });
            }
            
            return new Response('Telegram Bot is running', { status: 200 });
        } catch (error) {
            logger.error(`Fetch handler error: ${error.message}`);
            return new Response(JSON.stringify({ error: error.message }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }
    },
    
    async scheduled(event, env, ctx) {
        try {
            injectEnvironment(env);
            db.initDatabase(env.DB);
            
            // Run periodic cleanup/tasks here
            logger.info('Running scheduled task');
            
            // Example: Clean up old verified users, send notifications, etc.
        } catch (error) {
            logger.error(`Scheduled task error: ${error.message}`);
        }
    }
};

/**
 * Inject environment variables into globalThis
 */
function injectEnvironment(env) {
    globalThis.BOT_TOKEN = env.BOT_TOKEN;
    globalThis.ADMIN_ID = env.ADMIN_ID;
    globalThis.OXAPAY_API_KEY = env.OXAPAY_API_KEY;
    globalThis.OXAPAY_BASE_URL = env.OXAPAY_BASE_URL || 'https://api.oxapay.com';
    globalThis.GTC_PRICE_USDT = env.GTC_PRICE_USDT || '0.1';
    globalThis.PRESALE_GTC_REWARD = env.PRESALE_GTC_REWARD || '5000';
    globalThis.PRESALE_PRICE_USDT = env.PRESALE_PRICE_USDT || '0.05';
    globalThis.TGE_PRICE_USDT = env.TGE_PRICE_USDT || '0.2';
    globalThis.TGE_WITHDRAWAL_PERCENT = env.TGE_WITHDRAWAL_PERCENT || '50';
    globalThis.PRESALE_WITHDRAWAL_PERCENT = env.PRESALE_WITHDRAWAL_PERCENT || '75';
    globalThis.DEFAULT_REFER_AMOUNT = env.DEFAULT_REFER_AMOUNT || '100';
    globalThis.DEFAULT_MINE_AMOUNT = env.DEFAULT_MINE_AMOUNT || '1000';
    globalThis.DEFAULT_MIN_WITHDRAWAL = env.DEFAULT_MIN_WITHDRAWAL || '5000';
    globalThis.DEFAULT_MINE_COOLDOWN = env.DEFAULT_MINE_COOLDOWN || '86400';
    globalThis.WEBHOOK_PATH = env.WEBHOOK_PATH || '/api/telegram';
    globalThis.WEBHOOK_SECRET = env.WEBHOOK_SECRET || '';
    globalThis.REQUIRED_CHANNELS = env.REQUIRED_CHANNELS || '[]';
}
