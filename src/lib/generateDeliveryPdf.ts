import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { supabase } from '@/lib/supabase';

type DeliveryPDFData = {
    delivery_number: string;
    created_at: string;
    observations: string | null;
    shipping_method: string | null;
    shipping_address: string | null;
    shipping_carrier: string | null;
    tracking_number: string | null;
    work_order: {
        order_number: string;
        notes: string | null;
    };
    quotation: {
        quotation_number: string;
    };
    client: {
        business_name: string;
        rfc: string;
        email?: string;
        address?: string;
    };
    operations: {
        sequence: number;
        operation_type: string;
        description: string | null;
        status: string;
    }[];
};

export const generateDeliveryPDF = async (data: DeliveryPDFData) => {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();

    // Fetch company settings
    let company: any = null;
    try {
        const { data: cs } = await supabase.from('company_settings').select('*').limit(1).single();
        company = cs;
    } catch (_) { }

    let currentY = 22;

    // Logo
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
            doc.setTextColor(16, 185, 129);
            doc.text(company?.company_name || "VOXA", 14, currentY);
            currentY += 6;
        }
    } else {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(24);
        doc.setTextColor(16, 185, 129);
        doc.text(company?.company_name || "VOXA", 14, currentY);
        currentY += 6;
    }

    // Company info
    doc.setFontSize(10);
    doc.setTextColor(100, 116, 139);
    doc.setFont("helvetica", "normal");
    if (company?.email) { doc.text(company.email, 14, currentY); currentY += 5; }
    if (company?.phone) { doc.text(company.phone, 14, currentY); currentY += 5; }
    if (company?.address) { const lines = doc.splitTextToSize(company.address, 90); doc.text(lines, 14, currentY); currentY += lines.length * 5; }

    // Title
    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.setTextColor(15, 23, 42);
    doc.text("NOTA DE ENTREGA", pageWidth - 14, 25, { align: "right" });

    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(`Folio: ${data.delivery_number}`, pageWidth - 14, 32, { align: "right" });
    doc.text(`Fecha: ${new Date(data.created_at).toLocaleDateString()}`, pageWidth - 14, 37, { align: "right" });
    doc.text(`OT: ${data.work_order.order_number}`, pageWidth - 14, 42, { align: "right" });
    doc.text(`Cotización: ${data.quotation.quotation_number}`, pageWidth - 14, 47, { align: "right" });

    // Divider
    const dividerY = Math.max(currentY, 52);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.5);
    doc.line(14, dividerY, pageWidth - 14, dividerY);

    // Client details
    let nextY = dividerY + 10;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(30, 41, 59);
    doc.text("Datos del Cliente:", 14, nextY);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(`Razón Social: ${data.client.business_name}`, 14, nextY + 7);
    doc.text(`RFC: ${data.client.rfc}`, 14, nextY + 12);
    nextY += 17;
    if (data.client.email) { doc.text(`Email: ${data.client.email}`, 14, nextY); nextY += 5; }
    if (data.client.address) { doc.text(`Dirección: ${data.client.address}`, 14, nextY); nextY += 5; }

    // Shipping info
    if (data.shipping_method || data.shipping_address || data.shipping_carrier || data.tracking_number) {
        nextY += 5;
        doc.setFont("helvetica", "bold");
        doc.setFontSize(12);
        doc.setTextColor(30, 41, 59);
        doc.text("Datos de Envío:", 14, nextY);
        nextY += 7;
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.setTextColor(71, 85, 105);
        if (data.shipping_method) { doc.text(`Método: ${data.shipping_method}`, 14, nextY); nextY += 5; }
        if (data.shipping_carrier) { doc.text(`Paquetería: ${data.shipping_carrier}`, 14, nextY); nextY += 5; }
        if (data.tracking_number) { doc.text(`No. de Guía: ${data.tracking_number}`, 14, nextY); nextY += 5; }
        if (data.shipping_address) {
            const addrLines = doc.splitTextToSize(`Dirección de envío: ${data.shipping_address}`, pageWidth - 28);
            doc.text(addrLines, 14, nextY);
            nextY += addrLines.length * 5;
        }
    }

    // Operations table
    if (data.operations.length > 0) {
        const opsData = data.operations.map(op => [
            `#${op.sequence}`,
            op.operation_type,
            op.description || '—',
            op.status === 'Done' ? '✓ Completado' : 'Pendiente'
        ]);

        autoTable(doc, {
            startY: nextY + 8,
            head: [['#', 'Operación', 'Descripción', 'Estado']],
            body: opsData,
            theme: 'striped',
            headStyles: { fillColor: [16, 185, 129], textColor: 255, fontStyle: 'bold' },
            columnStyles: { 0: { cellWidth: 15, halign: 'center' }, 1: { cellWidth: 35 }, 2: { cellWidth: 'auto' }, 3: { cellWidth: 30, halign: 'center' } },
            styles: { fontSize: 9, cellPadding: 4 }
        });
        nextY = (doc as any).lastAutoTable.finalY + 10;
    }

    // Observations
    if (data.observations) {
        if (nextY + 30 > doc.internal.pageSize.getHeight() - 20) { doc.addPage(); nextY = 20; }
        doc.setDrawColor(226, 232, 240);
        doc.setLineWidth(0.5);
        doc.line(14, nextY, pageWidth - 14, nextY);
        nextY += 8;
        doc.setFont("helvetica", "bold");
        doc.setFontSize(10);
        doc.setTextColor(30, 41, 59);
        doc.text("Observaciones:", 14, nextY);
        nextY += 6;
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.setTextColor(100, 116, 139);
        const obsLines = doc.splitTextToSize(data.observations, pageWidth - 28);
        doc.text(obsLines, 14, nextY);
        nextY += obsLines.length * 5 + 10;
    }

    // Signature lines
    if (nextY + 40 > doc.internal.pageSize.getHeight() - 20) { doc.addPage(); nextY = 20; } else { nextY += 15; }
    doc.setDrawColor(148, 163, 184);
    doc.setLineWidth(0.3);
    const sigY = nextY + 15;
    doc.line(14, sigY, 90, sigY);
    doc.line(pageWidth - 90, sigY, pageWidth - 14, sigY);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text("Entrega", 52, sigY + 5, { align: "center" });
    doc.text("Recibe", pageWidth - 52, sigY + 5, { align: "center" });

    // Footer
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text("Nota de entrega generada por el sistema Voxa ERP.", pageWidth / 2, doc.internal.pageSize.getHeight() - 15, { align: "center" });

    doc.save(`${data.delivery_number}_NotaEntrega.pdf`);
};
