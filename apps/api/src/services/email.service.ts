import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses'
import { buildInviteEmailHtml } from '../templates/email-invite.js'

const SENDER = process.env.SES_SENDER_EMAIL ?? 'noreply@kanjibuddy.org'
const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:3000'

export class EmailService {
  private ses: SESClient

  constructor() {
    this.ses = new SESClient({
      region: process.env.AWS_REGION ?? 'us-east-1',
    })
  }

  async sendTutorInvite(
    teacherEmail: string,
    studentName: string,
    token: string,
  ): Promise<void> {
    const reportUrl = `${API_BASE_URL}/report/${token}`
    const html = buildInviteEmailHtml(studentName, reportUrl)

    const command = new SendEmailCommand({
      Source: SENDER,
      Destination: { ToAddresses: [teacherEmail] },
      Message: {
        Subject: {
          Data: `${studentName} has invited you to view their Japanese learning progress`,
          Charset: 'UTF-8',
        },
        Body: {
          Html: { Data: html, Charset: 'UTF-8' },
        },
      },
    })

    await this.ses.send(command)
  }
}
