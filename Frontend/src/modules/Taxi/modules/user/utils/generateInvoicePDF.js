import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';

export const generateInvoicePDF = async ({ details, invoiceRef, appName }) => {
  if (!invoiceRef || !invoiceRef.current) {
    throw new Error('Invoice template is not mounted');
  }

  const element = invoiceRef.current;
  const pages = Array.from(element.children);
  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: 'a4'
  });

  const pdfWidth = pdf.internal.pageSize.getWidth();
  const pdfHeight = pdf.internal.pageSize.getHeight();

  try {
    for (let i = 0; i < pages.length; i++) {
      const pageElement = pages[i];
      
      const canvas = await html2canvas(pageElement, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: true,
      });

      const imgData = canvas.toDataURL('image/jpeg', 1.0);
      const canvasRatio = canvas.height / canvas.width;
      const renderHeight = pdfWidth * canvasRatio;
      
      if (i > 0) {
        pdf.addPage();
      }
      
      pdf.addImage(imgData, 'JPEG', 0, 0, pdfWidth, renderHeight);
    }

    pdf.save(`${appName}-Invoice-${details.shortRideCode}.pdf`);
  } catch (error) {
    console.error('html2canvas or jsPDF error:', error);
    throw error;
  }
};
