import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';

interface DonationReceiptData {
  receiptNumber: string;
  donorName: string;
  donorEmail: string;
  amount: number;
  date: Date;
  paymentId: string;
  dedicatedTo?: string;
  message?: string;
  chapterName?: string;
}

interface MembershipReceiptData {
  receiptNumber: string;
  memberName: string;
  memberEmail: string;
  membershipTier: string;
  amount: number;
  startDate: Date;
  endDate: Date;
  paymentId: string;
}

const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
};

const formatDate = (date: Date): string => {
  return new Date(date).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
};

export class PDFReceiptGenerator {
  private doc: PDFKit.PDFDocument;
  private primaryColor = '#002045';
  private secondaryColor = '#b45309';
  private grayColor = '#64748b';

  constructor() {
    this.doc = new PDFDocument({
      size: 'A4',
      margin: 50,
    });
  }

  private addHeader(title: string) {
    // Logo placeholder (in production, use actual logo)
    this.doc
      .fontSize(24)
      .fillColor(this.primaryColor)
      .font('Helvetica-Bold')
      .text('AITD Connection', 50, 50);

    this.doc
      .fontSize(10)
      .fillColor(this.grayColor)
      .font('Helvetica')
      .text('AITD Alumni Network', 50, 78);

    // Divider line
    this.doc
      .strokeColor(this.secondaryColor)
      .lineWidth(2)
      .moveTo(50, 100)
      .lineTo(545, 100)
      .stroke();

    // Receipt title
    this.doc
      .fontSize(20)
      .fillColor(this.primaryColor)
      .font('Helvetica-Bold')
      .text(title, 50, 130, { align: 'center' });

    return this;
  }

  private addFooter() {
    const footerY = 750;

    this.doc
      .strokeColor('#e5e7eb')
      .lineWidth(1)
      .moveTo(50, footerY)
      .lineTo(545, footerY)
      .stroke();

    this.doc
      .fontSize(9)
      .fillColor(this.grayColor)
      .font('Helvetica')
      .text(
        'This is a computer-generated receipt and does not require a signature.',
        50,
        footerY + 15,
        { align: 'center' }
      );

    this.doc
      .fontSize(8)
      .text(
        'For any queries, contact: alumni@aitd.edu | +91-XXXX-XXXXXX',
        50,
        footerY + 30,
        { align: 'center' }
      );

    this.doc
      .text(
        'AITD Alumni Network | Registered under Section 80G',
        50,
        footerY + 45,
        { align: 'center' }
      );

    return this;
  }

  private addField(label: string, value: string, y: number) {
    this.doc
      .fontSize(10)
      .fillColor(this.grayColor)
      .font('Helvetica')
      .text(label, 50, y);

    this.doc
      .fontSize(12)
      .fillColor(this.primaryColor)
      .font('Helvetica-Bold')
      .text(value, 200, y);

    return this;
  }

  generateDonationReceipt(data: DonationReceiptData): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];

      this.doc.on('data', (chunk) => chunks.push(chunk));
      this.doc.on('end', () => resolve(Buffer.concat(chunks)));
      this.doc.on('error', reject);

      // Header
      this.addHeader('Donation Receipt');

      // Receipt details box
      this.doc
        .roundedRect(50, 170, 495, 100, 10)
        .fillColor('#f8fafc')
        .fill();

      this.doc
        .fontSize(12)
        .fillColor(this.grayColor)
        .font('Helvetica')
        .text('Receipt Number:', 70, 190);

      this.doc
        .fontSize(14)
        .fillColor(this.primaryColor)
        .font('Helvetica-Bold')
        .text(data.receiptNumber, 200, 190);

      this.doc
        .fontSize(12)
        .fillColor(this.grayColor)
        .font('Helvetica')
        .text('Date:', 70, 215);

      this.doc
        .fontSize(14)
        .fillColor(this.primaryColor)
        .font('Helvetica-Bold')
        .text(formatDate(data.date), 200, 215);

      this.doc
        .fontSize(12)
        .fillColor(this.grayColor)
        .font('Helvetica')
        .text('Payment ID:', 70, 240);

      this.doc
        .fontSize(12)
        .fillColor(this.primaryColor)
        .font('Helvetica')
        .text(data.paymentId, 200, 240);

      // Donor information section
      this.doc
        .fontSize(14)
        .fillColor(this.primaryColor)
        .font('Helvetica-Bold')
        .text('Donor Information', 50, 300);

      this.doc
        .strokeColor('#e5e7eb')
        .lineWidth(1)
        .moveTo(50, 318)
        .lineTo(545, 318)
        .stroke();

      this.addField('Name:', data.donorName, 335);
      this.addField('Email:', data.donorEmail, 360);

      // Donation details section
      this.doc
        .fontSize(14)
        .fillColor(this.primaryColor)
        .font('Helvetica-Bold')
        .text('Donation Details', 50, 410);

      this.doc
        .strokeColor('#e5e7eb')
        .lineWidth(1)
        .moveTo(50, 428)
        .lineTo(545, 428)
        .stroke();

      // Amount box
      this.doc
        .roundedRect(50, 450, 495, 60, 10)
        .fillColor(this.primaryColor)
        .fill();

      this.doc
        .fontSize(14)
        .fillColor('#ffffff')
        .font('Helvetica')
        .text('Donation Amount', 70, 465);

      this.doc
        .fontSize(24)
        .fillColor('#ffffff')
        .font('Helvetica-Bold')
        .text(formatCurrency(data.amount), 70, 482);

      let currentY = 530;

      if (data.chapterName) {
        this.addField('Chapter:', data.chapterName, currentY);
        currentY += 25;
      }

      if (data.dedicatedTo) {
        this.addField('Dedicated To:', data.dedicatedTo, currentY);
        currentY += 25;
      }

      if (data.message) {
        this.doc
          .fontSize(10)
          .fillColor(this.grayColor)
          .font('Helvetica')
          .text('Message:', 50, currentY);

        this.doc
          .fontSize(11)
          .fillColor(this.primaryColor)
          .font('Helvetica-Oblique')
          .text(`"${data.message}"`, 50, currentY + 18, {
            width: 495,
            align: 'left',
          });
        currentY += 50;
      }

      // Thank you message
      this.doc
        .roundedRect(50, currentY + 20, 495, 80, 10)
        .fillColor('#fef3c7')
        .fill();

      this.doc
        .fontSize(14)
        .fillColor(this.secondaryColor)
        .font('Helvetica-Bold')
        .text('Thank You for Your Generosity!', 50, currentY + 40, {
          width: 495,
          align: 'center',
        });

      this.doc
        .fontSize(11)
        .fillColor(this.grayColor)
        .font('Helvetica')
        .text(
          'Your contribution helps us support scholarships, events, and initiatives that strengthen our alumni community.',
          70,
          currentY + 60,
          { width: 455, align: 'center' }
        );

      // Footer
      this.addFooter();

      this.doc.end();
    });
  }

  generateMembershipReceipt(data: MembershipReceiptData): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];

      this.doc.on('data', (chunk) => chunks.push(chunk));
      this.doc.on('end', () => resolve(Buffer.concat(chunks)));
      this.doc.on('error', reject);

      // Header
      this.addHeader('Membership Receipt');

      // Receipt details box
      this.doc
        .roundedRect(50, 170, 495, 100, 10)
        .fillColor('#f8fafc')
        .fill();

      this.doc
        .fontSize(12)
        .fillColor(this.grayColor)
        .font('Helvetica')
        .text('Receipt Number:', 70, 190);

      this.doc
        .fontSize(14)
        .fillColor(this.primaryColor)
        .font('Helvetica-Bold')
        .text(data.receiptNumber, 200, 190);

      this.doc
        .fontSize(12)
        .fillColor(this.grayColor)
        .font('Helvetica')
        .text('Payment ID:', 70, 215);

      this.doc
        .fontSize(12)
        .fillColor(this.primaryColor)
        .font('Helvetica')
        .text(data.paymentId, 200, 215);

      this.doc
        .fontSize(12)
        .fillColor(this.grayColor)
        .font('Helvetica')
        .text('Transaction Date:', 70, 240);

      this.doc
        .fontSize(14)
        .fillColor(this.primaryColor)
        .font('Helvetica-Bold')
        .text(formatDate(data.startDate), 200, 240);

      // Member information section
      this.doc
        .fontSize(14)
        .fillColor(this.primaryColor)
        .font('Helvetica-Bold')
        .text('Member Information', 50, 300);

      this.doc
        .strokeColor('#e5e7eb')
        .lineWidth(1)
        .moveTo(50, 318)
        .lineTo(545, 318)
        .stroke();

      this.addField('Name:', data.memberName, 335);
      this.addField('Email:', data.memberEmail, 360);

      // Membership details section
      this.doc
        .fontSize(14)
        .fillColor(this.primaryColor)
        .font('Helvetica-Bold')
        .text('Membership Details', 50, 410);

      this.doc
        .strokeColor('#e5e7eb')
        .lineWidth(1)
        .moveTo(50, 428)
        .lineTo(545, 428)
        .stroke();

      // Tier badge
      this.doc
        .roundedRect(50, 450, 200, 50, 8)
        .fillColor(this.secondaryColor)
        .fill();

      this.doc
        .fontSize(12)
        .fillColor('#ffffff')
        .font('Helvetica')
        .text('Membership Tier', 60, 460);

      this.doc
        .fontSize(18)
        .fillColor('#ffffff')
        .font('Helvetica-Bold')
        .text(data.membershipTier, 60, 478);

      // Amount box
      this.doc
        .roundedRect(270, 450, 275, 50, 8)
        .fillColor(this.primaryColor)
        .fill();

      this.doc
        .fontSize(12)
        .fillColor('#ffffff')
        .font('Helvetica')
        .text('Amount Paid', 280, 460);

      this.doc
        .fontSize(18)
        .fillColor('#ffffff')
        .font('Helvetica-Bold')
        .text(formatCurrency(data.amount), 280, 478);

      // Validity period
      this.addField('Valid From:', formatDate(data.startDate), 520);
      this.addField('Valid Until:', formatDate(data.endDate), 545);

      // Benefits reminder
      this.doc
        .roundedRect(50, 590, 495, 100, 10)
        .fillColor('#f0fdf4')
        .fill();

      this.doc
        .fontSize(12)
        .fillColor('#16a34a')
        .font('Helvetica-Bold')
        .text('Your Membership Benefits:', 70, 610);

      const benefits = [
        'Full access to alumni directory and networking features',
        'Priority registration for events and reunions',
        'Exclusive job board access and career resources',
        'Featured profile in alumni directory',
      ];

      let benefitY = 630;
      benefits.forEach((benefit) => {
        this.doc
          .fontSize(10)
          .fillColor(this.grayColor)
          .font('Helvetica')
          .text(`✓ ${benefit}`, 80, benefitY);
        benefitY += 15;
      });

      // Footer
      this.addFooter();

      this.doc.end();
    });
  }
}

export const generateDonationReceipt = async (
  data: DonationReceiptData
): Promise<Buffer> => {
  const generator = new PDFReceiptGenerator();
  return generator.generateDonationReceipt(data);
};

export const generateMembershipReceipt = async (
  data: MembershipReceiptData
): Promise<Buffer> => {
  const generator = new PDFReceiptGenerator();
  return generator.generateMembershipReceipt(data);
};

// Generate unique receipt number
export const generateReceiptNumber = (type: 'DON' | 'MEM'): string => {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${type}-${timestamp}-${random}`;
};
