import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../../../.env') });

async function dropIndex() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected.');

        const collection = mongoose.connection.db.collection('food_page_contents');
        
        console.log('Dropping index: key_1');
        await collection.dropIndex('key_1');
        console.log('Dropped successfully.');

        process.exit(0);
    } catch (err) {
        console.error('ERROR dropping index:', err);
        process.exit(1);
    }
}

dropIndex();
