const Message = require('../models/message');
const { initializeDatabase } = require('./helpers/db-init');

async function checkMessages() {
  const messages = await Message.findAll();
  console.log(
    'Messages in database:',
    messages.map((m) => m.toJSON())
  );
}

initializeDatabase().then(() => {
  checkMessages();
});
