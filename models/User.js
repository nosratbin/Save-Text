const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const userSchema = new mongoose.Schema({ 
    username: { type: String, unique: true, required: true }, 
    password: { type: String, required: true }, 
    createdAt: { type: Date, default: Date.now } 
});

userSchema.pre('save', async function () { 
    if (this.isModified('password')) { 
        this.password = await bcrypt.hash(this.password, 10);
    } 
});

userSchema.methods.comparePassword = async function (password) { 
    return await bcrypt.compare(password, this.password); 
};

module.exports = mongoose.model('User', userSchema);