// seed.js - Populate local MongoDB with sample products for testing

require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("./db");
const Product = require("./product.model");

const sampleProducts = [
  
  {
    name: "Redmi 13C",
    brand: "Redmi",
    price: 8999,
    category: "Smartphones",
  },


   {
    name: "apple iphone 15",
    brand: "apple",
    price: 50000,
    category: "Smartphones",
  },



  {
    name: "Redmi Buds 5A",
    brand: "Redmi",
    price: 1499,
    category: "Audio",
  },
  {
    name: "Samsung Galaxy S24",
    brand: "Samsung",
    price: 74999,
    category: "Smartphones",
  },
  {
    name: "Samsung Galaxy Tab S9",
    brand: "Samsung",
    price: 65999,
    category: "Tablets",
  },
  {
    name: "Sony WH-1000XM5",
    brand: "Sony",
    price: 29990,
    category: "Audio",
  },
  {
    name: "Dell Inspiron 15",
    brand: "Dell",
    price: 54999,
    category: "Laptops",
  },
  {
    name: "HP Pavilion x360",
    brand: "HP",
    price: 62999,
    category: "Laptops",
  },
];

async function seed() {
  await connectDB();

  // Clear existing products
  await Product.deleteMany({});
  console.error("🗑️  Cleared existing products");

  // Insert sample products
  const inserted = await Product.insertMany(sampleProducts);
  console.error(`✅ Inserted ${inserted.length} sample products`);

  // List them
  inserted.forEach((p) => {
    console.error(`   • ${p.name} | ${p.brand} | ₹${p.price} | ${p.category}`);
  });

  await mongoose.connection.close();
  console.error("🔌 Database connection closed");
  process.exit(0);
}

seed().catch((err) => {
  console.error("❌ Seed error:", err.message);
  process.exit(1);
});

