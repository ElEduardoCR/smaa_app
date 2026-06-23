import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

type QuotationData = {
    quotation_number: string;
    created_at: string;
    subtotal: number;
    vat_total: number;
    total: number;
    seller?: string;
    delivery_time?: string;
    terms_conditions?: string;
    company?: {
        company_name: string;
        email?: string;
        phone?: string;
        address?: string;
        logo_url?: string;
    };
    client: {
        business_name: string;
        rfc: string;
        email?: string;
        address?: string;
        payment_days?: number | null;
        requires_advance?: boolean | null;
        advance_pct?: number | null;
    };
    items: {
        description: string;
        quantity: number;
        unit_price: number;
        line_total: number;
    }[];
};

export const generateQuotationPDF = async (data: QuotationData) => {
    // Create new A4 document
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();

    // --- SMAA brand palette (orange / black / gray) ---
    const ORANGE: [number, number, number] = [234, 88, 12];        // orange-600
    const ORANGE_SOFT: [number, number, number] = [255, 237, 213]; // orange-100
    const INK: [number, number, number] = [23, 23, 23];            // near-black
    const LINE: [number, number, number] = [212, 212, 212];        // neutral-300

    // Helper for currency formatting
    const formatCurrency = (amt: number) =>
        `$ ${Number(amt || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    // --- Header Section ---

    // Logo or Company Name
    let currentY = 22;
    if (data.company?.logo_url) {
        try {
            const response = await fetch(data.company.logo_url);
            const blob = await response.blob();
            const base64data = await new Promise<string>((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result as string);
                reader.readAsDataURL(blob);
            });

            // Load image to get natural dimensions and preserve aspect ratio
            const img = await new Promise<HTMLImageElement>((resolve, reject) => {
                const image = new window.Image();
                image.onload = () => resolve(image);
                image.onerror = reject;
                image.src = base64data;
            });

            const maxW = 45; // mm
            const maxH = 20; // mm
            const ratio = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight);
            const logoW = img.naturalWidth * ratio;
            const logoH = img.naturalHeight * ratio;

            doc.addImage(base64data, 'PNG', 14, 12, logoW, logoH, undefined, 'FAST');
            currentY = 12 + logoH + 4;
        } catch (e) {
            console.error("Failed to load logo for PDF", e);
            // Default to text if image fails
            doc.setFont("helvetica", "bold");
            doc.setFontSize(24);
            doc.setTextColor(ORANGE[0], ORANGE[1], ORANGE[2]);
            doc.text(data.company?.company_name || "SMAA", 14, currentY);
            currentY += 6;
        }
    } else {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(24);
        doc.setTextColor(ORANGE[0], ORANGE[1], ORANGE[2]);
        doc.text(data.company?.company_name || "SMAA", 14, currentY);
        currentY += 6;
    }

    // Company Contact Info
    doc.setFontSize(10);
    doc.setTextColor(100, 116, 139);
    doc.setFont("helvetica", "normal");

    if (data.company?.email) {
        doc.text(data.company.email, 14, currentY);
        currentY += 5;
    }
    if (data.company?.phone) {
        doc.text(data.company.phone, 14, currentY);
        currentY += 5;
    }
    if (data.company?.address) {
        // Split long address strings
        const addressLines = doc.splitTextToSize(data.company.address, 90);
        doc.text(addressLines, 14, currentY);
        currentY += (addressLines.length * 5);
    }

    // Document Title
    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.setTextColor(15, 23, 42);
    doc.text("COTIZACIÓN", pageWidth - 14, 25, { align: "right" });

    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(`Folio: ${data.quotation_number}`, pageWidth - 14, 32, { align: "right" });
    doc.text(`Fecha: ${new Date(data.created_at).toLocaleDateString()}`, pageWidth - 14, 37, { align: "right" });

    // Divider Line (orange accent)
    const dividerY = Math.max(currentY, 45);
    doc.setDrawColor(ORANGE[0], ORANGE[1], ORANGE[2]);
    doc.setLineWidth(0.8);
    doc.line(14, dividerY, pageWidth - 14, dividerY);

    // --- Client Details ---
    const clientStartY = dividerY + 10;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(30, 41, 59);
    doc.text("Datos del Cliente:", 14, clientStartY);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(`Razón Social: ${data.client.business_name}`, 14, clientStartY + 7);
    doc.text(`RFC: ${data.client.rfc}`, 14, clientStartY + 12);

    let nextClientY = clientStartY + 17;
    if (data.client.email) {
        doc.text(`Email: ${data.client.email}`, 14, nextClientY);
        nextClientY += 5;
    }
    if (data.client.address) {
        doc.text(`Dirección: ${data.client.address}`, 14, nextClientY);
        nextClientY += 5;
    }

    // Seller & Delivery Time (right column)
    let metaRightY = clientStartY + 7;
    if (data.seller) {
        doc.setFont("helvetica", "normal");
        doc.setTextColor(100, 116, 139);
        doc.text("Vendedor:", pageWidth - 80, metaRightY);
        doc.setTextColor(15, 23, 42);
        doc.text(data.seller, pageWidth - 14, metaRightY, { align: "right" });
        metaRightY += 6;
    }
    if (data.delivery_time) {
        doc.setFont("helvetica", "normal");
        doc.setTextColor(100, 116, 139);
        doc.text("Tiempo de Entrega:", pageWidth - 80, metaRightY);
        doc.setTextColor(15, 23, 42);
        doc.text(data.delivery_time, pageWidth - 14, metaRightY, { align: "right" });
        metaRightY += 6;
    }

    // Payment conditions (from the client)
    const pdays = data.client.payment_days;
    const paymentText = pdays && pdays > 0 ? `Crédito ${pdays} días` : "Pago de contado";
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100, 116, 139);
    doc.text("Condiciones de pago:", pageWidth - 80, metaRightY);
    doc.setTextColor(15, 23, 42);
    doc.text(paymentText, pageWidth - 14, metaRightY, { align: "right" });
    metaRightY += 6;
    if (data.client.requires_advance) {
        const adv = data.client.advance_pct != null ? `Requiere ${data.client.advance_pct}%` : "Requerido";
        doc.setTextColor(100, 116, 139);
        doc.text("Anticipo:", pageWidth - 80, metaRightY);
        doc.setTextColor(15, 23, 42);
        doc.text(adv, pageWidth - 14, metaRightY, { align: "right" });
        metaRightY += 6;
    }

    // --- Items Table ---
    const tableData = data.items.map(item => [
        item.description,
        item.quantity.toString(),
        formatCurrency(item.unit_price),
        formatCurrency(item.line_total)
    ]);

    const tableStartY = Math.max(nextClientY + 10, metaRightY + 4, dividerY + 35);

    autoTable(doc, {
        startY: tableStartY,
        margin: { left: 14, right: 14 },
        head: [['Descripción', 'Cantidad', 'Precio Unitario', 'Importe']],
        body: tableData,
        theme: 'grid',
        headStyles: {
            fillColor: ORANGE,
            textColor: 255,
            fontStyle: 'bold',
            lineColor: ORANGE,
            lineWidth: 0.1,
        },
        bodyStyles: {
            textColor: INK,
        },
        alternateRowStyles: {
            fillColor: [250, 250, 250],
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
            lineColor: LINE,
            lineWidth: 0.1,
        },
    });

    // Rounded orange frame around the table
    const tableEndY = (doc as any).lastAutoTable.finalY;
    doc.setDrawColor(ORANGE[0], ORANGE[1], ORANGE[2]);
    doc.setLineWidth(0.5);
    doc.roundedRect(14, tableStartY, pageWidth - 28, tableEndY - tableStartY, 3, 3, 'S');

    // --- Totals Section ---
    const finalY = (doc as any).lastAutoTable.finalY + 14;
    const totalsX = pageWidth - 68;

    // Rounded card behind the totals
    doc.setFillColor(ORANGE_SOFT[0], ORANGE_SOFT[1], ORANGE_SOFT[2]);
    doc.setDrawColor(ORANGE[0], ORANGE[1], ORANGE[2]);
    doc.setLineWidth(0.4);
    doc.roundedRect(totalsX - 6, finalY - 8, pageWidth - 14 - (totalsX - 6) + 4, 32, 3, 3, 'FD');

    // Subtotal
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(90, 90, 90);
    doc.text("Subtotal:", totalsX, finalY);
    doc.setTextColor(INK[0], INK[1], INK[2]);
    doc.text(formatCurrency(data.subtotal), pageWidth - 16, finalY, { align: "right" });

    // IVA
    doc.setTextColor(90, 90, 90);
    doc.text("IVA (16%):", totalsX, finalY + 7);
    doc.setTextColor(INK[0], INK[1], INK[2]);
    doc.text(formatCurrency(data.vat_total), pageWidth - 16, finalY + 7, { align: "right" });

    // Total Line
    doc.setDrawColor(ORANGE[0], ORANGE[1], ORANGE[2]);
    doc.setLineWidth(0.4);
    doc.line(totalsX, finalY + 11, pageWidth - 16, finalY + 11);

    // Total
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(INK[0], INK[1], INK[2]);
    doc.text("Total Neto:", totalsX, finalY + 18);
    doc.setTextColor(ORANGE[0], ORANGE[1], ORANGE[2]);
    doc.text(formatCurrency(data.total), pageWidth - 16, finalY + 18, { align: "right" });

    // --- Terms & Conditions ---
    let termsY = finalY + 25;
    if (data.terms_conditions) {
        // Check if need page break
        if (termsY + 30 > doc.internal.pageSize.getHeight() - 20) {
            doc.addPage();
            termsY = 20;
        }
        doc.setDrawColor(226, 232, 240);
        doc.setLineWidth(0.5);
        doc.line(14, termsY, pageWidth - 14, termsY);
        termsY += 8;

        doc.setFont("helvetica", "bold");
        doc.setFontSize(10);
        doc.setTextColor(30, 41, 59);
        doc.text("Términos y Condiciones:", 14, termsY);
        termsY += 6;

        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.setTextColor(100, 116, 139);
        const termsLines = doc.splitTextToSize(data.terms_conditions, pageWidth - 28);
        doc.text(termsLines, 14, termsY);
    }

    // --- Footer ---
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text("Esta cotización es de carácter informativo y está sujeta a cambios.", pageWidth / 2, doc.internal.pageSize.getHeight() - 15, { align: "center" });

    // Trigger download
    doc.save(`${data.quotation_number}_Cotizacion.pdf`);
};
