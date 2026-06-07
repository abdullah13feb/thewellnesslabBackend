import { PrismaClient } from '@prisma/client';
import nodemailer from 'nodemailer';

const prisma = new PrismaClient();

export class EmailSenderService {
  /**
   * Get all sender accounts
   */
  async getAllSenders() {
    return prisma.emailSenderAccount.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get active sender accounts
   */
  async getActiveSenders() {
    return prisma.emailSenderAccount.findMany({
      where: { isActive: true },
    });
  }

  /**
   * Create a new sender account
   */
  async createSender(data: { name: string; email: string; password: string; smtpHost?: string; smtpPort?: number }) {
    // Verify connection before saving
    await this.verifyConnection(data.email, data.password, data.smtpHost, data.smtpPort);

    return prisma.emailSenderAccount.create({
      data: {
        name: data.name,
        email: data.email,
        password: data.password,
        smtpHost: data.smtpHost || 'smtp.gmail.com',
        smtpPort: data.smtpPort || 465,
        isActive: true,
      },
    });
  }

  /**
   * Update an existing sender account
   */
  async updateSender(id: string, data: { name?: string; email?: string; password?: string; smtpHost?: string; smtpPort?: number; isActive?: boolean }) {
    // If updating credentials, verify them
    if (data.email || data.password || data.smtpHost || data.smtpPort) {
      const existing = await prisma.emailSenderAccount.findUnique({ where: { id } });
      if (!existing) throw new Error('Sender account not found');

      const checkEmail = data.email || existing.email;
      const checkPassword = data.password || existing.password;
      const checkHost = data.smtpHost || existing.smtpHost;
      const checkPort = data.smtpPort || existing.smtpPort;

      await this.verifyConnection(checkEmail, checkPassword, checkHost, checkPort);
    }

    return prisma.emailSenderAccount.update({
      where: { id },
      data,
    });
  }

  /**
   * Delete a sender account
   */
  async deleteSender(id: string) {
    return prisma.emailSenderAccount.delete({
      where: { id },
    });
  }

  /**
   * Verify SMTP connection
   */
  async verifyConnection(email: string, password: string, host = 'smtp.gmail.com', port = 465) {
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465, // true for 465, false for other ports
      auth: {
        user: email,
        pass: password,
      },
    });

    try {
      await transporter.verify();
      return true;
    } catch (error: any) {
      console.error('SMTP Connection Error:', error);
      throw new Error(`Failed to connect to SMTP server: ${error.message}`);
    }
  }
}

export const emailSenderService = new EmailSenderService();
