require('dotenv').config()
const stripe = require('stripe')(process.env.STRIPE_PUBLISHABLE_KEY);
const paypal = require('paypal-rest-sdk');
const User = require('../models/users');
const Order = require("../models/order")
const Package = require("../models/package")
const url = require('url');
const { encodeMsg } = require('../helper/createMsg');

paypal.configure({
    mode: process.env.SITE_DEBUG ? 'sandbox' : 'live',
    client_id: process.env.PAYPAL_CLIENT_ID,
    client_secret: process.env.PAYPAL_CLIENT_SECRET
})
const calculateOrderAmount = (items) => {
    const { price, tax } = items;
    // calculating tax
    const totalAmount = price * ((100 + tax) / 100)
    // converting to cents because stripe accept cents only
    return totalAmount * 100;
};
module.exports = {
    async paypalAPI(req, res) {
        try {
            const { userId, id, dob } = req.body;
            const user = await User.findById(userId).populate('package');
            console.log(req.body)
            if (user) {
                await user.updateOne({ dob, driver_license: id })
                const create_payment_json = {
                    intent: 'sale',
                    payer: {
                        payment_method: 'paypal',
                    },
                    redirect_urls: {
                        return_url: `${process.env.SERVER_URI}/success?user=${user._id.toString()}&package=${user.package._id}`,
                        cancel_url: `${process.env.SERVER_URI}/payment?user=${user._id.toString()}`
                    },
                    transactions: [
                        {
                            item_list: {
                                items: [
                                    {
                                        name: user.package.name,
                                        description: user.package.description,
                                        quantity: 1,
                                        price: user.package.price * ((100 + user.package.tax) / 100),
                                        // tax: '0.45',
                                        currency: 'USD',
                                    }
                                ],
                            },
                            amount: {
                                currency: 'USD',
                                total: user.package.price * ((100 + user.package.tax) / 100),
                            },
                            payment_options: {
                                allowed_payment_method: 'IMMEDIATE_PAY',
                            },
                        },
                    ],
                };
                paypal.payment.create(create_payment_json, (e, payment) => {
                    if (e) {
                        console.log(e.response.details)
                        return res.status(500).json({ error: e.response.message });
                    }
                    for (let i = 0; i < payment.links.length; i++) {
                        if (payment.links[i].rel === 'approval_url') {
                            console.log(payment.links[i].href)
                            res.send({ url: payment.links[i].href })
                        }
                    }
                })
                return true;
            }
            res.send({ url: `${process.env.SERVER_URI}/` })
        } catch (error) {
            res.send({ error: "Server Error" })
        }
    },
    async stripeIntent(req, res) {
        try {
            const { userId, id, dob } = req.body;
            const user = await User.findById(userId).populate('package');
            if (user) {
                await user.updateOne({ dob, driver_license: id })

                // Create a PaymentIntent with the order amount and currency
                const paymentIntent = await stripe.paymentIntents.create({
                    amount: calculateOrderAmount(user.package),
                    currency: "usd",
                    setup_future_usage: 'off_session',
                    // payment_method_types:['card'],
                    automatic_payment_methods: {
                        enabled: true,
                    },
                });
                res.send({
                    clientSecret: paymentIntent.client_secret,
                    id: paymentIntent.id
                });
            }
        } catch (error) {
            res.send({ error: "Server error" })
        }
    },
    async stripeIntentCancel(req, res) {
        try {
            const paymentIntent = await stripe.paymentIntents.cancel(
                req.body.id
            );
            console.log(paymentIntent)
            res.send(paymentIntent)
        } catch (error) {
            res.send({ error: "Server error" })
        }
    },
    async paymentSuccess(req, res) {
        try {
            const userId = req.query.user;
            console.log(req.query)
            // payment_intent is generated by stripe
            // paymentId is generated by paypal
            const paymentId = req.query.payment_intent || req.query.paymentId;
            const user = await User.findById(userId).populate('package');
            // const package = await Package.findById(packageId);
            if (user) {
                const order = await Order({
                    user: user._id,
                    package: user.package._id,
                    amount: user.package.price * ((100 + user.package.tax) / 100),
                    pay_method: req.query.payment_intent ? "Stripe" : "PayPal",
                    transaction: paymentId,
                    verified: true
                }).save()
                if (order) {
                    return req.login(user, function (err) {
                        if (err) { return next(err); }
                        return res.redirect(url.format({
                            pathname: '/dashboard',
                            query: {
                                msg: encodeMsg('Welcome to Real Estate')
                            }
                        }));
                    });
                }
            }
            return res.redirect(url.format({
                pathname: '/payment',
                query: {
                    user: userId
                }
            }))
        } catch (error) {
            console.log("500 Erro:", error)
            res.render('500')
        }
    }
}