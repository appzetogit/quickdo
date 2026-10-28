import nodemailer from 'nodemailer';
import { emailCredentials } from '../../../core/settings/platformProfile.service.js';

// SMTP from Master settings if saved there, else .env; rebuilt when it changes.
let transporter = null;
let transporterKey = '';
const getTransporter = () => {
  const mail = emailCredentials();
  const key = `${mail.host}|${mail.port}|${mail.user}|${mail.pass}|${mail.secure}`;
  if (!transporter || key !== transporterKey) {
    transporter = nodemailer.createTransport({
      host: mail.host,
      port: mail.port,
      secure: mail.secure,
      auth: { user: mail.user, pass: mail.pass },
    });
    transporterKey = key;
  }
  return transporter;
};

export const sendEmail = async ({ to, subject, text, html }) => {
  try {
    const mailOptions = {
      from: emailCredentials().from || '"Quick Drop" <noreply@example.com>',
      to,
      subject,
      text,
      html,
    };

    const info = await getTransporter().sendMail(mailOptions);
    console.log(`Email sent: ${info.messageId}`);
    return info;
  } catch (error) {
    console.error('Error sending email:', error);
    throw error;
  }
};
