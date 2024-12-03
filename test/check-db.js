const Message = require('../models/message');

async function checkMessages() {
  const messages = await Message.findAll();
  console.log('Messages in database:', messages.map(m => m.toJSON()));
}

checkMessages(); 