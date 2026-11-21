"""Definições comuns de Internet: estoques mensais do SCM, não usuários únicos."""
URL='https://informacoes.anatel.gov.br/paineis/acessos/banda-larga-fixa'
POP_URL='https://sidra.ibge.gov.br/tabela/6579'
NOTA_BASE='Retratos do mês de dezembro em anos encerrados e do último mês nacional disponível no ano corrente. Não são somas anuais. Cada ano usa o mesmo mês em todos os municípios; ausência não vira zero. Regiões usam razões das somas dos componentes municipais válidos.'
NOTA_ANATEL='Anatel · SCM: acessos de banda larga fixa declarados pelas prestadoras. Um acesso é uma assinatura, não uma pessoa ou domicílio único. O meio de acesso descreve a última milha. Velocidade é contratada, não medida. Tipo de pessoa é o titular da assinatura. Campos inexistentes nas edições antigas permanecem indisponíveis.'
NOTA_MERCADO='Prestadoras são CNPJs declarantes com acessos positivos, não grupos econômicos. Nos agregados, os acessos são reunidos por CNPJ antes da contagem e da concentração. Participação da maior declarante e HHI não são médias municipais nem avaliações da concorrência. Havendo acessos sem CNPJ válido, os índices ficam indisponíveis.'
NOTA_EN='December snapshots for closed years and the latest nationally available month for the current year; not annual sums. SCM subscriptions are not unique people or households. Contracted speed is not measured speed. Missing fields and missing records remain unavailable.'
CONDICOES={0:'Registrado',1:'Zero registrado',2:'Sem registro na fonte',3:'Denominador ausente',4:'Denominador zero',5:'Fora da cobertura do campo',16:'Cobertura incompleta'}
MESES=[('jan','Janeiro','January'),('fev','Fevereiro','February'),('mar','Março','March'),('abr','Abril','April'),('mai','Maio','May'),('jun','Junho','June'),('jul','Julho','July'),('ago','Agosto','August'),('set','Setembro','September'),('out','Outubro','October'),('nov','Novembro','November'),('dez','Dezembro','December')]
GRUPOS={
 'meio':[('fibra','Fibra óptica','Fibre optic'),('metal','Cabo metálico','Copper cable'),('coaxial','Cabo coaxial','Coaxial cable'),('radio','Rádio','Radio'),('satelite','Satélite','Satellite'),('outros','Outros meios ou não informados','Other or unspecified media')],
 'faixa':[('512k','Até 512 kbps','Up to 512 kbps'),('2m','De 512 kbps a 2 Mbps','512 kbps to 2 Mbps'),('12m','De 2 a 12 Mbps','2 to 12 Mbps'),('34m','De 12 a 34 Mbps','12 to 34 Mbps'),('mais34','Acima de 34 Mbps','Above 34 Mbps'),('outras','Outras faixas ou não informadas','Other or unspecified bands')],
 'porte':[('peq','Prestadoras de pequeno porte','Small providers'),('grande','Prestadoras de grande porte','Large providers'),('ign','Porte não informado','Unspecified size')],
 'pessoa':[('fisica','Pessoa física','Individual subscriber'),('juridica','Pessoa jurídica','Legal-entity subscriber'),('ign','Tipo de titular não informado','Unspecified subscriber type')],
 'vel':[('100','100 Mbps ou mais','100 Mbps or more'),('1000','1 Gbps ou mais','1 Gbps or more'),('ign','Velocidade numérica não informada','Unspecified numeric speed')]
}
