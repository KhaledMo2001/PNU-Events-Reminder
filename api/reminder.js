const admin = require('firebase-admin');
const axios = require('axios');

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
const EMAILJS_SERVICE_ID = process.env.EMAILJS_SERVICE_ID;
const EMAILJS_TEMPLATE_ID = process.env.EMAILJS_TEMPLATE_ID;
const EMAILJS_USER_ID = process.env.EMAILJS_USER_ID;
const CRON_SECRET = process.env.CRON_SECRET;

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}
const db = admin.firestore();

module.exports = async (req, res) => {
  if (req.query.secret !== CRON_SECRET) {
    return res.status(401).json({ error: 'غير مصرح' });
  }

  try {
    const now = new Date();
    const in24Hours = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const in25Hours = new Date(now.getTime() + 25 * 60 * 60 * 1000);

    const eventsSnapshot = await db.collection('events')
      .where('date', '>=', in24Hours)
      .where('date', '<', in25Hours)
      .get();

    if (eventsSnapshot.empty) {
      return res.json({ message: 'لا توجد فعاليات خلال 24 ساعة' });
    }

    for (const eventDoc of eventsSnapshot.docs) {
      const event = eventDoc.data();
      const eventId = eventDoc.id;

      const registrationsSnapshot = await db.collection('registrations')
        .where('eventId', '==', eventId)
        .where('status', '==', 'approved')
        .where('reminderSent', '==', false)
        .get();

      if (registrationsSnapshot.empty) continue;

      for (const regDoc of registrationsSnapshot.docs) {
        const reg = regDoc.data();
        const userDoc = await db.collection('users').doc(reg.userId).get();
        if (!userDoc.exists) continue;

        const user = userDoc.data();
        const eventDate = event.date.toDate();

        await axios.post('https://api.emailjs.com/api/v1.0/email/send', {
          service_id: EMAILJS_SERVICE_ID,
          template_id: EMAILJS_TEMPLATE_ID,
          user_id: EMAILJS_USER_ID,
          template_params: {
            to_email: user.email,
            to_name: user.name,
            event_title: event.title,
            event_date: eventDate.toLocaleDateString('ar-SA', {
              weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
            }),
            event_location: event.location || 'غير محدد'
          }
        });

        await regDoc.ref.update({ reminderSent: true });
      }
    }

    res.json({ message: 'تمت معالجة التذكيرات' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
};