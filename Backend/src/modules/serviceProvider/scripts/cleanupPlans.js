const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

async function migrate() {
    try {
        console.log('Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI);
        const db = mongoose.connection.db;
        const plansCollection = db.collection('sp_plans');
        
        console.log('Fetching all plans...');
        const plans = await plansCollection.find({}).toArray();
        console.log(`Found ${plans.length} plans.`);

        for (const plan of plans) {
            console.log(`Processing plan: ${plan.name} (${plan._id})`);
            
            // 1. Remove freeBrands top-level field
            const unsetObj = { freeBrands: "" };
            
            // 2. Clean bonusServices array (removing brandId from all objects)
            if (plan.bonusServices && Array.isArray(plan.bonusServices)) {
                plan.bonusServices = plan.bonusServices.map(bs => {
                    const { brandId, ...rest } = bs;
                    return rest;
                });
            }

            // 3. Update the document using direct MongoDB command to ignore Schema restrictions
            await plansCollection.updateOne(
                { _id: plan._id },
                { 
                    $unset: { freeBrands: 1 }, 
                    $set: { bonusServices: plan.bonusServices }
                }
            );
            console.log(`- Plan "${plan.name}" updated (raw).`);
        }

        console.log('RAW Migration completed.');
        process.exit(0);
    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    }
}

migrate();
