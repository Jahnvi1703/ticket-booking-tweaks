import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

// Background Task 1 Helper: Booking Confirmation Email
export async function sendBookingEmail(toEmail, eventName) {

  // Temporary benchmark mock: bypass Resend quota
  // console.log(`[MOCK EMAIL] Simulating email to ${toEmail} for ${eventName}`);
  // return { success: true };

  try {
    const data = await resend.emails.send({
      from: "onboarding@resend.dev", // Free sandbox sender
      to: toEmail,
      subject: `Booking Confirmed: ${eventName}`,
      html: `<h2>Booking Confirmed!</h2><p>Your ticket for <strong>${eventName}</strong> has been secured successfully.</p>`,
    });
    console.log(`[EMAIL SENT] Booking confirmation delivered to: ${toEmail}`);
    return data;
  } catch (err) {
    console.error(`[EMAIL ERROR] Booking email failed for ${toEmail}:`, err.message);
  }
}

// Background Task 2 Helper: Event Update Email
export async function sendEventUpdateEmail(toEmail, eventName) {

  try {
    const data = await resend.emails.send({
      from: "onboarding@resend.dev",
      to: toEmail,
      subject: `Event Notice: ${eventName} Details Updated`,
      html: `<h2>Event Updated</h2><p>Important update: The organizer has modified the schedule or details for <strong>${eventName}</strong>.</p>`,
    });
    console.log(`[EMAIL SENT] Event update delivered to: ${toEmail} (ID: ${data.id})`);
    return data;
  } catch (err) {
    console.error(`[EMAIL ERROR] Event update email failed for ${toEmail}:`, err.message);
  }
}