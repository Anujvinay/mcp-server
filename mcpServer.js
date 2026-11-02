
require("dotenv").config();

const express = require("express");
const axios = require("axios");
const { z } = require("zod");

const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");

const connectDB = require("./db");
const Product = require("./product.model");

// Express server
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 5000;

// ========================================
// 1. MongoDB se product search karna
//    (Yeh same function MCP aur Groq dono use karenge)
//    Ab yeh name, brand, category, aur price sab mein search karega
//    AI decide karega ki kaunse fields bhejne hain
// ========================================
async function searchProduct({ query, category, minPrice, maxPrice }) {
    // Filter object banao - sirf woh fields daalo jo AI ne bheje hain
    const filter = {};

    // Agar query hai to name ya brand mein dhundho (partial match + case insensitive)
    if (query && query.trim()) {
        const regex = new RegExp(query.trim(), "i");
        filter.$or = [
            { name: regex },
            { brand: regex }
        ];
    }

    // Agar category hai to category mein bhi dhundho
    if (category && category.trim()) {
        filter.category = new RegExp(category.trim(), "i");
    }

    // Agar price range hai to price filter lagao
    if (minPrice !== undefined || maxPrice !== undefined) {
        filter.price = {};
        if (minPrice !== undefined) filter.price.$gte = minPrice;
        if (maxPrice !== undefined) filter.price.$lte = maxPrice;
    }

    const products = await Product.find(filter);
    return products;
}

// ========================================
// 2. Groq API ko call karna
//    (Simple helper function - sirf API call karega)
// ========================================
async function callGroqAPI(messages, tools) {
    // Request body banana
    const body = {
        model: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
        messages: messages
    };

    // Sirf pehli baar tools bhejo, final answer ke liye nahi
    if (tools) {
        body.tools = tools;
        body.tool_choice = "auto";
    }

    // Axios se Groq API call karo
    const { data } = await axios.post(
        "https://api.groq.com/openai/v1/chat/completions",
        body,
        {
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${process.env.GROQ_API_KEY}`
            }
        }
    );

    return data.choices[0].message;
}

// ========================================
// 3. Groq se baat karna (main logic)
//    FIX: Pehle AI decide karega ki tool call karna hai ya nahi
//    Agar tool call kiya to result AI ko wapas bhejenge
//    Agar nahi kiya to seedha jawab dega (greetings, general questions)
// ========================================

// Yeh tools array define karo - AI ko batata hai ki searchProduct available hai
// AI user ka question samajh ke sahi fields fill karega
const tools = [
    {
        type: "function",
        function: {
            name: "searchProduct",
            description: "Search products in MongoDB database. Use this whenever user asks about any product, brand, category, or price. Extract the right search fields from the user's question. You can use any combination of the parameters below.",
            parameters: {
                type: "object",
                properties: {
                    query: {
                        type: "string",
                        description: "Product name or brand name to search (e.g. 'Redmi', 'Samsung', 'Sony'). Extract the core product/brand name from the user's message, even if they write in Hindi, Hinglish, or with spelling mistakes."
                    },
                    category: {
                        type: "string",
                        description: "Product category to filter (e.g. 'Smartphones', 'Laptops', 'Audio', 'Tablets'). Use when user mentions a type of product."
                    },
                    minPrice: {
                        type: "number",
                        description: "Minimum price filter. Use when user says 'above X', 'more than X', 'X se zyada'."
                    },
                    maxPrice: {
                        type: "number",
                        description: "Maximum price filter. Use when user says 'under X', 'below X', 'X se kam', 'budget'."
                    }
                },
                required: []
            }
        }
    }
];

async function chatWithGroq(message) {

    // System prompt - AI ko samjhao ki kya karna hai
    // Yeh prompt AI ko ChatGPT jaisa smart banata hai
    const messages = [
        {
            role: "system",
            content: `You are a friendly and helpful AI shopping assistant, like ChatGPT. You understand English, Hindi, and Hinglish naturally.

GREETING & GENERAL QUESTIONS (e.g. "hi", "hello", "namaste", "kaise ho", "what is AI"):
- Answer naturally and in a friendly way. Do NOT call any tool.
- Reply in the same language the user used.

PRODUCT-RELATED QUESTIONS (e.g. "show me Redmi phones", "Samsung dikhao", "20000 ke andar laptop", "mujhe earbuds chahiye"):
- ALWAYS use the searchProduct tool.
- Extract the correct search parameters from the user's question:
  * query = product name or brand (e.g. "Redmi", "Samsung", "Sony")
  * category = product type (e.g. "Smartphones", "Laptops", "Audio", "Tablets")
  * minPrice / maxPrice = price range if mentioned
- You can use any combination of parameters. Not all are required.
- If the user has spelling mistakes, try to understand the intended product/brand name.
- ONLY present information from the tool results. NEVER invent product names, prices, or specifications.
- If the tool returns found=false or no products, reply exactly: "No product found in our database."
- If products are found, present them clearly with name, brand, price, and category.
- Reply in the same language the user asked in.`
        },
        {
            role: "user",
            content: message
        }
    ];

    // ---- STEP 1: Pehla API call (tools ke saath) ----
    // AI decide karega: tool call karna hai ya seedha jawab dena hai
    const aiResponse = await callGroqAPI(messages, tools);

    // ---- STEP 2: Agar AI ne tool call NAHI kiya ----
    // Matlab yeh greeting ya general question hai - seedha jawab do
    if (!aiResponse.tool_calls || aiResponse.tool_calls.length === 0) {
        return aiResponse.content || "I'm here to help! Ask me about products.";
    }

    // ---- STEP 3: AI ne tool call kiya - ab MongoDB se search karo ----
    const toolCall = aiResponse.tool_calls[0];
    const args = JSON.parse(toolCall.function.arguments);

    // MongoDB se products dhundho
    // AI ne jo bhi fields bheje (query, category, minPrice, maxPrice) woh sab pass karo
    const products = await searchProduct(args);

    // Result banao - agar products mile to unka data, nahi to "not found"
    let toolResult;
    if (products.length === 0) {
        toolResult = JSON.stringify({
            found: false,
            message: "No product found in our database."
        });
    } else {
        toolResult = JSON.stringify({
            found: true,
            count: products.length,
            products: products.map(p => ({
                name: p.name,
                brand: p.brand,
                price: p.price,
                category: p.category
            }))
        });
    }

    // ---- STEP 4: AI ko result wapas bhejo ----
    // Pehle AI ka tool_call message add karo
    messages.push(aiResponse);

    // Phir tool ka result add karo
    messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: toolResult
    });

    // ---- STEP 5: Final answer lo (bina tools ke) ----
    // FIX: Doosri baar tools NAHI bhejenge - warna AI dubara tool call kar sakta hai
    const finalAnswer = await callGroqAPI(messages, null);

    return finalAnswer.content;
}

// ========================================
// 4. Express API - Postman ke liye
// ========================================
app.post("/chat", async (req, res) => {
    try {
        const message = req.body.message;

        if (!message || typeof message !== "string" || message.trim().length === 0) {
            return res.status(400).json({
                success: false,
                reply: "Please enter a message."
            });
        }

        const reply = await chatWithGroq(message.trim());

        res.json({
            success: true,
            reply: reply
        });

    } catch (error) {
        console.error("Chat error:", error.message);

        res.status(500).json({
            success: false,
            reply: "Something went wrong. Please try again."
        });
    }
});

// Health check route
app.get("/", (req, res) => {
    res.json({ status: "ok", message: "Product Search AI is running" });
});

// ========================================
// 5. MCP Server - Claude Desktop / MCP clients ke liye
//    (Same searchProduct function use hoga)
// ========================================
const mcpServer = new McpServer({
    name: "productSearch",
    version: "1.0.0"
});

mcpServer.tool(
    "searchProduct",
    "Search products from MongoDB by name, brand, category, or price range",
    {
        query: z.string().optional().describe("Product name or brand"),
        category: z.string().optional().describe("Product category like Smartphones, Laptops, Audio, Tablets"),
        minPrice: z.number().optional().describe("Minimum price"),
        maxPrice: z.number().optional().describe("Maximum price")
    },
    async (args) => {
        try {
            const products = await searchProduct(args);

            const result = products.length
                ? JSON.stringify(products.map(p => ({
                    name: p.name,
                    brand: p.brand,
                    price: p.price,
                    category: p.category
                })))
                : "No product found in our database.";

            return {
                content: [{ type: "text", text: result }]
            };

        } catch (error) {
            return {
                content: [{ type: "text", text: "Error: " + error.message }],
                isError: true
            };
        }
    }
);

// ========================================
// 6. Server start karna
// ========================================
async function startServer() {
    // MongoDB connect karo
    await connectDB();

    // Express server start karo (Postman ke liye)
    app.listen(PORT, () => {
        console.error("Express server running on http://localhost:" + PORT);
        console.error("POST http://localhost:" + PORT + "/chat");
    });

    // MCP stdio server start karo (Claude Desktop ke liye)
    const transport = new StdioServerTransport();
    await mcpServer.connect(transport);
    console.error("MCP server started on stdio");
}

startServer().catch(error => {
    console.error("Server failed:", error.message);
    process.exit(1);
});
