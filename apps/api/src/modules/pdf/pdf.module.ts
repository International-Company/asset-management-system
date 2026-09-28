import { Global, Module } from '@nestjs/common';
import { OfficialDocumentService } from './official-document.service';
import { PdfService } from './pdf.service';

@Global()
@Module({
  providers: [PdfService, OfficialDocumentService],
  exports: [PdfService, OfficialDocumentService],
})
export class PdfModule {}
