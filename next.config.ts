import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Los documentos del expediente (INE, actas, CSF escaneadas) viajan en
    // base64 a una server action. El default de 1 MB deja fuera casi
    // cualquier PDF escaneado. El bucket employee_files topa en 25 MB;
    // base64 infla ~33%, así que 20 MB aquí cubre archivos de ~15 MB.
    serverActions: { bodySizeLimit: '20mb' },
  },
};

export default nextConfig;
