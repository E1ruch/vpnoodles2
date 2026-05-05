import QRCode from 'qrcode';
import type { IQRCodeService } from '../../domain/interfaces/services.js';

export class QRCodeService implements IQRCodeService {
  async generateBase64(data: string): Promise<string> {
    return QRCode.toDataURL(data, {
      width: 256,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#ffffff',
      },
    });
  }
}
