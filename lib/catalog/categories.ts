// Categoria sugerida a partir da descrição do produto.
// Regras copiadas do sistema de estoque da IC Supra (src/lib/setores.js), já validadas
// contra o catálogo real. É só uma sugestão: o gestor pode trocar no catálogo.
// A primeira regra que bater vence; termos específicos vêm antes dos genéricos.

const RULES: { category: string; terms: string[] }[] = [
  { category: "Ostomia", terms: ["colostomia", "ostomia", "bolsa colet"] },
  {
    category: "Respiratório",
    terms: ["cpap", "bipap", "nebuliza", "oxig", "concentrador", "traqueal", "traqueo", "traqueia", "umidificador", "aspirador", "mascara oro-nasal", "mascara nasal", "cânula", "canula", "respiron"],
  },
  {
    category: "Curativos e Feridas",
    terms: ["curativo", "gaze", "atadura", "esparadrapo", "micropor", "alginato", "hidrocoloide", "hidrogel", "espuma sacral", "fita adesiva", "fita cirurg"],
  },
  {
    category: "Diagnóstico",
    terms: ["esfigmoman", "estetosc", "oximetro", "termometro", "glicose", "glicemia", "lanceta", "balanca", "otoscopio", "monitor", "aparelho digital"],
  },
  {
    category: "Instrumental Cirúrgico",
    terms: ["pinca", "tesoura", "porta agulha", "cabo para bisturi", "lamina de bisturi", "lamina bisturi", "campo oper", "avental cirur"],
  },
  {
    category: "Ortopédicos",
    terms: ["joelheira", "tornozeleira", "colar cervical", "tala ", "imobilizador", "ortese", "orteses", "colete", "muleta", "bengala", "tipoia", "munhequeira", "cotoveleira", "espaldeira", "faixa abdominal", "faixa toracica", "corretor postural", "venosan", "meia de compress", "meia compress", "comfortline", "ultraline", "utraline", "legline", "supportline", "silverline", "ponteira"],
  },
  {
    category: "Mobilidade",
    terms: ["cadeira de rodas", "cadeira higien", "cadeira de banho", "cadeira motorizada", "andador", "assento sanitario", "suporte p/soro", "maca inox", "maca retratil", "maca tipo sked", "maca de qualidade", "maca p/massagem", "maca/diva", "diva maca", "carro maca", "p/ maca", "p/maca", "maca maleta", "prancha", "escada"],
  },
  { category: "Camas e mobiliário", terms: ["cama ", "cama fawler", "cama hosp", "colchao", "colchão"] },
  {
    category: "Descartáveis e Consumo",
    terms: ["seringa", "agulha", "luva", "sonda", "scalp", "cateter", "equipo", "soro fisio", "algodao", "alcool", "mascara descartavel", "mascara kn95", "touca desc", "propé", "sapatilha", "papagaio", "comadre"],
  },
  { category: "Enxoval e Higiene", terms: ["lencol", "fralda", "papel toalha", "toalha", "capa hosp", "travesseiro", "coxim"] },
  {
    category: "Farmácia/Medicamentos",
    terms: ["dipirona", "paracetamol", "dexametasona", "omeprazol", "losartana", "metronidazol", "nimesulida", "nimesulide", "amitriptilina", "bromazepam", "clonazepam", "diazepam", "alprazolam", "carvedilol", "amoxicilina", "azitromicina", "cetoconazol", "nifedipina", "naloxona", "nistatina", "pantoprazol", "metformina", "secnidazol", "lidocaina", "heparina", "soro fisiologico", "manitol", "cloreto de sodio", "agua para injecao", "agua p/ injetaveis", "sertralina", "acido valproico", "carbonato de litio"],
  },
  {
    category: "Odontológico",
    terms: ["broca", "resina", "lima endo", "lima k", "cureta", "catgut", "cimento odont", "espatula odont", "dique de borracha", "moldeira", "alginato odont", "brunidor"],
  },
  {
    category: "Beleza & Estética",
    terms: ["babyliss", "taiff", "tintura", "koleston", "coloracao", "hair", "corretivo liquido", "maquiagem", "condicionador alyne", "condicionador balsamo", "escova progressiva", "chapinha", "base facial", "po compacto"],
  },
];

const DRUG_DOSAGE = /\d+\s?(mg|mcg|ui)\b/i;

export function suggestCategory(description: string): string {
  const d = description.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  for (const rule of RULES) {
    if (rule.terms.some((t) => d.includes(t.normalize("NFD").replace(/[̀-ͯ]/g, "")))) return rule.category;
  }
  if (DRUG_DOSAGE.test(d)) return "Farmácia/Medicamentos";
  return "Outros";
}
