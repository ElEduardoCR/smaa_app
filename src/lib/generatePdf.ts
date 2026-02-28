import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

type QuotationData = {
    quotation_number: string;
    created_at: string;
    subtotal: number;
    vat_total: number;
    total: number;
    client: {
        business_name: string;
        rfc: string;
        email?: string;
        address?: string;
    };
    items: {
        description: string;
        quantity: number;
        unit_price: number;
        line_total: number;
    }[];
};

export const generateQuotationPDF = (data: QuotationData) => {
    // Create new A4 document
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();

    // Helper for currency formatting
    const formatCurrency = (amt: number) => `$ ${amt.toFixed(2)}`;

    // --- Header Section ---
    // Company Name
    doc.setFont("helvetica", "bold");
    doc.setFontSize(24);
    doc.setTextColor(79, 70, 229); // Indigo 600
    doc.text("VOXA", 14, 22);

    doc.setFontSize(10);
    doc.setTextColor(100, 116, 139); // Slate 500
    doc.setFont("helvetica", "normal");
    doc.text("Enterprise Resource Planning", 14, 28);
    doc.text("contacto@voxa.com", 14, 33);

    // Document Title
    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.setTextColor(15, 23, 42); // Slate 900
    doc.text("COTIZACIÓN", pageWidth - 14, 25, { align: "right" });

    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(`Folio: ${data.quotation_number}`, pageWidth - 14, 32, { align: "right" });
    doc.text(`Fecha: ${new Date(data.created_at).toLocaleDateString()}`, pageWidth - 14, 37, { align: "right" });

    // Divider Line
    doc.setDrawColor(226, 232, 240); // Slate 200
    doc.setLineWidth(0.5);
    doc.line(14, 45, pageWidth - 14, 45);

    // --- Client Details ---
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(30, 41, 59); // Slate 800
    doc.text("Datos del Cliente:", 14, 55);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(`Razón Social: ${data.client.business_name}`, 14, 62);
    doc.text(`RFC: ${data.client.rfc}`, 14, 67);
    if (data.client.email) doc.text(`Email: ${data.client.email}`, 14, 72);
    if (data.client.address) doc.text(`Dirección: ${data.client.address}`, 14, 77);

    // --- Items Table ---
    const tableData = data.items.map(item => [
        item.description,
        item.quantity.toString(),
        formatCurrency(item.unit_price),
        formatCurrency(item.line_total)
    ]);

    autoTable(doc, {
        startY: 85,
        head: [['Descripción', 'Cantidad', 'Precio Unitario', 'Importe']],
        body: tableData,
        theme: 'striped',
        headStyles: {
            fillColor: [79, 70, 229], // Indigo 600
            textColor: 255,
            fontStyle: 'bold',
        },
        columnStyles: {
            0: { cellWidth: 'auto' },
            1: { cellWidth: 25, halign: 'center' },
            2: { cellWidth: 35, halign: 'right' },
            3: { cellWidth: 35, halign: 'right' },
        },
        styles: {
            fontSize: 9,
            cellPadding: 4,
        }
    });

    // --- Totals Section ---
    const finalY = (doc as any).lastAutoTable.finalY + 10;
    const totalsX = pageWidth - 65;

    // Subtotal
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100, 116, 139);
    doc.text("Subtotal:", totalsX, finalY);
    doc.setTextColor(15, 23, 42);
    doc.text(formatCurrency(data.subtotal), pageWidth - 14, finalY, { align: "right" });

    // IVA
    doc.setTextColor(100, 116, 139);
    doc.text("IVA (16%):", totalsX, finalY + 7);
    doc.setTextColor(15, 23, 42);
    doc.text(formatCurrency(data.vat_total), pageWidth - 14, finalY + 7, { align: "right" });

    // Total Line
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.5);
    doc.line(totalsX, finalY + 11, pageWidth - 14, finalY + 11);

    // Total
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("Total Neto:", totalsX, finalY + 18);
    doc.setTextColor(16, 185, 129); // Emerald 500
    doc.text(formatCurrency(data.total), pageWidth - 14, finalY + 18, { align: "right" });

    // --- Footer ---
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184); // Slate 400
    doc.text("Esta cotización es de carácter informativo y está sujeta a cambios.", pageWidth / 2, doc.internal.pageSize.getHeight() - 15, { align: "center" });

    // Trigger download
    doc.save(`${data.quotation_number}_Cotizacion.pdf`);
};
