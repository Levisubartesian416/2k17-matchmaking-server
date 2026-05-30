const express = require('express');
const router = express.Router();
const Stripe = require('stripe');
const db = require('../database');
const { authMiddleware } = require('../middleware/auth');
require('dotenv').config();

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const VC_PACKS = {
    '5000': { price: 199, name: '5,000 VC Pack' },
    '15000': { price: 499, name: '15,000 VC Pack' },
    '35000': { price: 999, name: '35,000 VC Pack' },
    '75000': { price: 1999, name: '75,000 VC Pack' },
    '200000': { price: 4999, name: '200,000 VC Pack' },
    '450000': { price: 9999, name: '450,000 VC Pack' }
};

// Create a checkout session
router.post('/create-checkout-session', authMiddleware, async (req, res) => {
    try {
        const { amount } = req.body;
        const userId = req.user.id;

        if (!VC_PACKS[amount]) {
            return res.status(400).json({ error: 'Invalid VC amount' });
        }

        if (!process.env.STRIPE_SECRET_KEY) {
            return res.status(500).json({ error: 'Stripe is not configured. Add STRIPE_SECRET_KEY to .env' });
        }

        const pack = VC_PACKS[amount];

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [
                {
                    price_data: {
                        currency: 'usd',
                        product_data: {
                            name: pack.name,
                            description: `Virtual Currency for NBA 2K17 Revival`,
                        },
                        unit_amount: pack.price,
                    },
                    quantity: 1,
                },
            ],
            mode: 'payment',
            success_url: `https://2k17-matchmaking-server.onrender.com/api/store/success?amount=${amount}`,
            cancel_url: `https://2k17-matchmaking-server.onrender.com/api/store/cancel`,
            metadata: {
                userId,
                vcAmount: amount
            }
        });

        res.json({ url: session.url });
    } catch (err) {
        console.error('[STRIPE] Error creating session:', err);
        res.status(500).json({ error: err.message });
    }
});

// Simple success/cancel pages
router.get('/success', (req, res) => {
    res.send(`
        <div style="font-family: sans-serif; text-align: center; margin-top: 50px;">
            <h1 style="color: #10b981;">Payment Successful!</h1>
            <p>Your ${req.query.amount} VC has been added to your account.</p>
            <p>You can close this window and return to the launcher.</p>
        </div>
    `);
});

router.get('/cancel', (req, res) => {
    res.send(`
        <div style="font-family: sans-serif; text-align: center; margin-top: 50px;">
            <h1 style="color: #ef4444;">Payment Cancelled</h1>
            <p>No charges were made. You can close this window.</p>
        </div>
    `);
});

// Webhook for Stripe to notify us
router.post('/webhook', express.raw({type: 'application/json'}), (req, res) => {
    const sig = req.headers['stripe-signature'];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
    let event;

    try {
        if (endpointSecret) {
            event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
        } else {
            event = req.body; // Unsecured for local testing if no secret provided
        }
    } catch (err) {
        console.error('[STRIPE] Webhook signature verification failed.', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const userId = session.metadata.userId;
        const vcAmount = parseInt(session.metadata.vcAmount);

        // Add coins to user
        if (userId && vcAmount) {
            console.log(`[STRIPE] Payment received! Adding ${vcAmount} VC to user ${userId}`);
            db.addCoins(userId, vcAmount);
        }
    }

    res.json({received: true});
});

module.exports = router;
