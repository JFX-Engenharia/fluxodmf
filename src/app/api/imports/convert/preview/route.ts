import { ApiError, handleApiError, ok } from "@/lib/api";
import { requireTab } from "@/lib/auth";
import { assertBodySize, MEGABYTE } from "@/lib/body-size";
import { prisma } from "@/lib/db";
import { convertRawFile } from "@/lib/flow-converter";
import { readConvertUpload } from "../upload";

const MAX_BODY_SIZE = 25 * MEGABYTE;

/** Le o export bruto e mostra o que sairia na planilha de fluxo, sem gerar nada. */
export async function POST(request: Request) {
  try {
    await requireTab("importar");

    assertBodySize(request, MAX_BODY_SIZE);
    const { file, data } = await readConvertUpload(await request.formData());
    const works = await prisma.work.findMany({ where: { active: true } });

    let conversion;
    try {
      conversion = await convertRawFile(file.name, data, works);
    } catch {
      throw new ApiError(
        400,
        "Nao foi possivel ler a planilha. Se o arquivo for um .xls antigo, reexporte como .xlsx.",
      );
    }

    return ok(conversion);
  } catch (error) {
    return handleApiError(error);
  }
}
