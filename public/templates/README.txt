Modelos de medição por empresa (arquivo-base do escritor de template).
Coloque aqui vale.xlsx — o modelo de medição da Vale. Lido em runtime por fetch("/templates/vale.xlsx").

vale.xlsx — histórico
  14/09/2026  modelo da Vale como recebido (18 colunas na aba "Turmas Realizadas").
  20/10/2026  colunas E..H viram quatro: "Data início", "Data fim", "Horário início",
              "Horário fim" (antes: "Data", "Horário"). As demais colunas andaram duas
              posições; estilos, larguras e a aba Plantas são os do arquivo original.
              O escritor copia o cabeçalho e os estilos DESTE arquivo por posição, então
              ele e domain/exports/templates/vale.ts precisam ter as mesmas colunas na
              mesma ordem — smoke:medicao-vale confere linha 1 contra o template.
