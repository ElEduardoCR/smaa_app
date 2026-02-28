import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { supabase } from '@/lib/supabase';

type POData = {
    po_number: string;
    created_at: string;
    subtotal: number;
    vat_total: number;
    total: number;
    supplier: {
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

export const generatePurchaseOrderPDF = async (data: POData) => {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const formatCurrency = (amt: number) => `$ ${amt.toFixed(2)}`;

    // Fetch company settings for header
    let company: any = null;
    try {
        const { data: cs } = await supabase.from('company_settings').select('*').limit(1).single();
        company = cs;
    } catch (_) { }

    let currentY = 22;
    // Logo or Company Name
    if (company?.logo_url) {
        try {
            const response = await fetch(company.logo_url);
            const blob = await response.blob();
            const base64data = await new Promise<string>((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result as string);
                reader.readAsDataURL(blob);
            });
            const img = await new Promise<HTMLImageElement>((resolve, reject) => {
                const image = new window.Image();
                image.onload = () => resolve(image);
                image.onerror = reject;
                image.src = base64data;
            });
            const maxW = 45, maxH = 20;
            const ratio = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight);
            doc.addImage(base64data, 'PNG', 14, 12, img.naturalWidth * ratio, img.naturalHeight * ratio, undefined, 'FAST');
            currentY = 12 + (img.naturalHeight * ratio) + 4;
        } catch (_) {
            doc.setFont("helvetica", "bold");
            doc.setFontSize(24);
            doc.setTextColor(244, 63, 94);
            doc.text(company?.company_name || "VOXA", 14, currentY);
            currentY += 6;
        }
    } else {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(24);
        doc.setTextColor(244, 63, 94);
        doc.text(company?.company_name || "VOXA", 14, currentY);
        currentY += 6;
    }

    doc.setFontSize(10);
    doc.setTextColor(100, 116, 139);
    doc.setFont("helvetica", "normal");
    if (company?.email) { doc.text(company.email, 14, currentY); currentY += 5; }
    if (company?.phone) { doc.text(company.phone, 14, currentY); currentY += 5; }
    if (company?.address) { const lines = doc.splitTextToSize(company.address, 90); doc.text(lines, 14, currentY); currentY += lines.length * 5; }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.setTextColor(15, 23, 42);
    doc.text("ORDEN DE COMPRA", pageWidth - 14, 25, { align: "right" });

    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(`Folio: ${data.po_number}`, pageWidth - 14, 32, { align: "right" });
    doc.text(`Fecha: ${new Date(data.created_at).toLocaleDateString()}`, pageWidth - 14, 37, { align: "right" });

    const dividerY = Math.max(currentY, 45);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.5);
    doc.line(14, dividerY, pageWidth - 14, dividerY);

    const clientStartY = dividerY + 10;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(30, 41, 59);
    doc.text("Datos del Proveedor:", 14, clientStartY);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(`Razón Social: ${data.supplier.business_name}`, 14, clientStartY + 7);
    doc.text(`RFC: ${data.supplier.rfc}`, 14, clientStartY + 12);
    let nextY = clientStartY + 17;
    if (data.supplier.email) { doc.text(`Email: ${data.supplier.email}`, 14, nextY); nextY += 5; }
    if (data.supplier.address) { doc.text(`Dirección: ${data.supplier.address}`, 14, nextY); }

    const tableData = data.items.map(item => [item.description, item.quantity.toString(), formatCurrency(item.unit_price), formatCurrency(item.line_total)]);

    autoTable(doc, {
        startY: Math.max(nextY + 10, dividerY + 35),
        head: [['Descripción', 'Cantidad', 'Precio Unitario', 'Importe']],
        body: tableData,
        theme: 'striped',
        headStyles: { fillColor: [244, 63, 94], textColor: 255, fontStyle: 'bold' },
        columnStyles: { 0: { cellWidth: 'auto' }, 1: { cellWidth: 25, halign: 'center' }, 2: { cellWidth: 35, halign: 'right' }, 3: { cellWidth: 35, halign: 'right' } },
        styles: { fontSize: 9, cellPadding: 4 }
    });

    const finalY = (doc as any).lastAutoTable.finalY + 10;
    const totalsX = pageWidth - 65;

    doc.setFont("helvetica", "normal");
    doc.setTextColor(100, 116, 139);
    doc.text("Subtotal:", totalsX, finalY);
    doc.setTextColor(15, 23, 42);
    doc.text(formatCurrency(data.subtotal), pageWidth - 14, finalY, { align: "right" });

    doc.setTextColor(100, 116, 139);
    doc.text("IVA (16%):", totalsX, finalY + 7);
    doc.setTextColor(15, 23, 42);
    doc.text(formatCurrency(data.vat_total), pageWidth - 14, finalY + 7, { align: "right" });

    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.5);
    doc.line(totalsX, finalY + 11, pageWidth - 14, finalY + 11);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("Total Neto:", totalsX, finalY + 18);
    doc.setTextColor(244, 63, 94);
    doc.text(formatCurrency(data.total), pageWidth - 14, finalY + 18, { align: "right" });

    doc.setFont("helvetica", "italic");
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text("Orden de compra generada por el sistema Voxa ERP.", pageWidth / 2, doc.internal.pageSize.getHeight() - 15, { align: "center" });

    doc.save(`${data.po_number}_OrdenCompra.pdf`);
};
