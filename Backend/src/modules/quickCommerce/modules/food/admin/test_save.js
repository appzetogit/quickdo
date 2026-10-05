import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { FoodPageContent } from './models/pageContent.model.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../../../.env') });

async function testSave() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected.');

        const k = 'support';
        const m = 'USER';
        const title = 'Help & Support';
        const content = 'Test content';

        console.log(`Trying to save key: ${k}, module: ${m}`);
        
        const doc = await FoodPageContent.findOneAndUpdate(
            { key: k, module: m },
            {
                $set: {
                    key: k,
                    module: m,
                    legal: { title, content },
                    about: undefined,
                    updatedBy: null,
                    updatedByRole: 'ADMIN'
                }
            },
            { upsert: true, new: true, runValidators: true }
        );

        console.log('Saved successfully:', doc._id);
        process.exit(0);
    } catch (err) {
        console.error('SAVE ERROR:', err);
        process.exit(1);
    }
}

testSave();
