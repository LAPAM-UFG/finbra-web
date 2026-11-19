"""Definições e normalização dos perfis adicionais de frota e óbitos."""
import argparse,json
from pathlib import Path
import numpy as np,pandas as pd
from mobilidade_fontes import compacto,sha
from mobilidade_normalizar import chave,ler_planilha

DIC_SIM='https://app.wiki.saude.es.gov.br/vigilancia/microdados/dicionario-de-dados-sim-tabela-do.pdf'
NOTA_PERFIS='Ampliação de Mobilidade: espécie/eixos sem arquivo de dezembro de 2018, sem substituição por outro mês. Eixos 1–9 são recorte descritivo; zero e demais valores ficam separados. Raça/cor inclui informação ignorada no denominador. Escolaridade usa ESC apenas entre óbitos de 15+, incluindo ignorados, sem converter ESC2010. Local do falecimento não é local do acidente. Acidente de trabalho: percentual de sim entre respostas conhecidas, com cobertura do campo e sub-registro explícitos. Mês é o da data do óbito, não do acidente; contagens mensais somam o total anual, com mês inválido separado.'
MESES=[('jan','Janeiro'),('fev','Fevereiro'),('mar','Março'),('abr','Abril'),('mai','Maio'),('jun','Junho'),('jul','Julho'),('ago','Agosto'),('set','Setembro'),('out','Outubro'),('nov','Novembro'),('dez','Dezembro')]
RACAS=[('branca','Branca','1'),('preta','Preta','2'),('amarela','Amarela','3'),('parda','Parda','4'),('indigena','Indígena','5')]
LOCAIS=[('hospital','Hospital','1'),('outro_estab','Outro estabelecimento de saúde','2'),('domicilio','Domicílio','3'),('via_publica','Via pública','4'),('outro_local','Outros locais','5'),('aldeia','Aldeia indígena','6')]
ESCOLAS=[('nenhuma','Nenhuma escolaridade','1'),('1_3','1 a 3 anos de estudo','2'),('4_7','4 a 7 anos de estudo','3'),('8_11','8 a 11 anos de estudo','4'),('12_mais','12 anos ou mais de estudo','5')]
ESPECIES=[('passageiro','Passageiros'),('carga','Carga'),('misto','Mistos'),('corrida','Corrida'),('tracao','Tração'),('especial','Especiais'),('colecao','Coleção'),('sem_classe','Sem classificação específica')]

SIM_PERFIS={}
def sim(id,nome,familia,expr,descricao):SIM_PERFIS[id]=dict(nome=nome,familia=familia,expr=expr,descricao=descricao)
for id,nome,code in RACAS:sim('mob_ob_rc_'+id,'Mortes: raça/cor '+nome.lower(),'raca',f"RACACOR='{code}'",'Raça/cor registrada na declaração de óbito (RACACOR). Participações usam todos os óbitos de moradores, incluindo raça/cor ignorada; não são taxas de risco por grupo racial.')
sim('mob_ob_rc_ign','Mortes: raça/cor sem informação','raca',"RACACOR IS NULL OR RACACOR NOT IN ('1','2','3','4','5')",'Raça/cor vazia, ignorada ou fora dos cinco códigos definidos no SIM. Permanece no denominador das participações.')
sim('mob_ob_rc_info','Mortes com raça/cor informada','raca',"RACACOR IN ('1','2','3','4','5')",'Auxiliar: soma dos cinco grupos válidos de RACACOR; não somar novamente com seus componentes.')
for id,nome,code in LOCAIS:sim('mob_ob_loc_'+id,'Falecimentos em '+nome.lower(),'local_obito',f"LOCOCOR='{code}'",'Local do falecimento (LOCOCOR), entre óbitos de moradores por transporte terrestre. Hospital, via pública e demais categorias não identificam o local onde ocorreu o acidente; não se inferem tempo de resgate nem qualidade do atendimento.')
sim('mob_ob_loc_ign','Falecimentos: local sem informação','local_obito',"LOCOCOR IS NULL OR LOCOCOR NOT IN ('1','2','3','4','5','6')",'Local do falecimento vazio, ignorado ou não classificado nos seis códigos do SIM. Município de referência continua sendo o de residência.')
for j,(id,nome)in enumerate(MESES,1):sim('mob_ob_mes_'+id,'Óbitos em '+nome.lower(),'sazonalidade',f'mes_obito={j}','Mês da data do óbito (DTOBITO), não necessariamente mês do acidente. As 12 contagens e a categoria sem mês somam o total anual. Pequenas contagens variam; meses têm durações diferentes.')
sim('mob_ob_mes_ign','Óbitos sem mês válido','sazonalidade','mes_obito IS NULL OR mes_obito NOT BETWEEN 1 AND 12','Mês ausente ou fora de 1–12 em DTOBITO; não se distribui artificialmente entre os meses.')
sim('mob_ob_15_mais','Óbitos com 15 anos ou mais','escolaridade','idade_anos>=15','Denominador do perfil de escolaridade: moradores com 15 anos ou mais, segundo a idade no SIM. Idades ignoradas e menores de 15 ficam fora deste perfil.')
for id,nome,code in ESCOLAS:sim('mob_ob_esc_'+id,'Mortes (15+): '+nome.lower(),'escolaridade',f"idade_anos>=15 AND ESC='{code}'",'Escolaridade em anos de estudo no campo ESC, apenas entre óbitos com 15 anos ou mais. Não se convertem códigos de ESC2010 em anos nem se inferem etapas concluídas. Participação calculada sobre todos os óbitos de 15+, incluindo escolaridade ignorada.')
sim('mob_ob_esc_ign','Mortes (15+): escolaridade ignorada','escolaridade',"idade_anos>=15 AND (ESC IS NULL OR ESC NOT IN ('1','2','3','4','5'))",'Entre óbitos de 15+, escolaridade ESC vazia, ignorada ou fora dos cinco códigos definidos. Ausência não significa nenhuma escolaridade.')
sim('mob_ob_esc_info','Mortes (15+): escolaridade informada','escolaridade',"idade_anos>=15 AND ESC IN ('1','2','3','4','5')",'Auxiliar: óbitos de 15+ com ESC entre 1 e 5. Não somar novamente às faixas de estudo.')
for id,nome,expr in [('sim','Sim',"ACIDTRAB='1'"),('nao','Não',"ACIDTRAB='2'"),('ign','Sem informação',"ACIDTRAB IS NULL OR ACIDTRAB NOT IN ('1','2')"),('info','Informado',"ACIDTRAB IN ('1','2')")]:
 sim('mob_ob_trab_'+id,'Acidente de trabalho no registro: '+nome.lower(),'acidente_trabalho',expr,'Marcação ACIDTRAB na declaração, entre óbitos de moradores por transporte terrestre. Não é contagem exaustiva de mortes de trabalhadores: há sub-registro e informação ignorada. “Não” é resposta explícita; branco/ignorado fica separado. O percentual de “sim” usa somente os registros com resposta sim/não.')

FROTA_PERFIS={}
def frota(id,nome,familia,descricao):FROTA_PERFIS[id]=dict(nome=nome,familia=familia,descricao=descricao)
frota('mob_esp_total','Veículos no cadastro de espécie/eixos','especie','Total do retrato de dezembro por espécie/eixos; pode diferir de outros cadastros. Espécie é a classificação do registro, não o uso efetivo ou a oferta de transporte.')
for id,nome in ESPECIES:frota('mob_esp_'+id,'Espécie: '+nome.lower(),'especie','Espécie cadastrada pela Senatran: passageiro, carga, misto, corrida, tração, especial e coleção. As demais grafias/códigos ficam em sem classificação específica. Não confundir espécie com tipo de veículo nem somar esses dois recortes. Falta arquivo de dezembro de 2018 nesta edição.')
for id,nome in [('1','1 eixo'),('2','2 eixos'),('3','3 eixos'),('4','4 eixos'),('5_9','5 a 9 eixos'),('zero','Zero ou ausente no cadastro'),('outros','Outros valores de eixos')]:frota('mob_eix_'+id,'Cadastro de eixos: '+nome,'eixos','Número informado no registro, não verificação física. Zero/ausente fica separado. Outros valores preserva negativos, não inteiros, não numéricos e 10 ou mais: não são corrigidos nem interpretados como quantidade física de eixos. A faixa de 1 a 9 é apenas recorte descritivo, não certificação de validade.')
frota('mob_eix_1_9','Registros com 1 a 9 eixos','eixos','Auxiliar: quantidade de veículos com EIXOS inteiro entre 1 e 9. Não se usa o campo para estimar fluxo, capacidade de carga ou eixos físicos totais.')
frota('mob_cg_eix_1_9','Espécie carga com 1 a 9 eixos','eixos','Denominador: veículos classificados na espécie CARGA e com EIXOS inteiro entre 1 e 9. Espécie carga pode incluir tipos distintos de caminhão.')
frota('mob_cg_eix_3_9','Espécie carga com 3 a 9 eixos','eixos','Numerador: espécie CARGA com EIXOS inteiro entre 3 e 9. Participação restrita aos registros de carga com 1 a 9 eixos; os demais valores são apresentados à parte.')

def agrupar_especies(x):
 """Partições exaustivas: nenhum eixo é recodificado de 20 para 2, por exemplo."""
 n=pd.to_numeric(x['eixos'],errors='coerce');inteiro=n.notna()&(n%1==0);faixa=inteiro&n.between(1,9);e=x['especie'].map(chave);q=x['quantidade'];z=x[['uf','municipio']].copy();z['mob_esp_total']=q
 known={id for id,_ in ESPECIES if id!='sem_classe'}
 for id,_ in ESPECIES:z['mob_esp_'+id]=q.where(~e.isin(known)if id=='sem_classe'else e==id,0)
 masks={'1':inteiro&(n==1),'2':inteiro&(n==2),'3':inteiro&(n==3),'4':inteiro&(n==4),'5_9':inteiro&n.between(5,9),'zero':(n==0)|x.eixos.isna()|x.eixos.astype(str).str.strip().eq('')}
 masks['outros']=~np.logical_or.reduce(list(masks.values()))
 for id,mask in masks.items():z['mob_eix_'+id]=q.where(mask,0)
 z['mob_eix_1_9']=q.where(faixa,0);z['mob_cg_eix_1_9']=q.where((e=='carga')&faixa,0);z['mob_cg_eix_3_9']=q.where((e=='carga')&inteiro&n.between(3,9),0)
 return z.groupby(['uf','municipio'],as_index=False).sum(numeric_only=True)

def normalizar(fontes):
 fontes=Path(fontes).resolve();work=fontes/'perfis_normalizados';work.mkdir(exist_ok=True);m=json.loads((fontes/'senatran_perfis.json').read_bytes());g=json.loads((fontes/'geografia.json').read_bytes());ufs={chave(uf):uf for _,_,uf in g['governos']};ufs.update({chave(nome):uf for _,nome,uf in g['governos']});out=[]
 for ref in m['arquivos']:
  p=fontes/ref['arquivo'];assert sha(p.read_bytes())==ref['sha256'];dest=work/f"{ref['ano']}_especie.parquet";meta=dest.with_suffix('.json')
  if dest.exists()and meta.exists():
   d=json.loads(meta.read_bytes());assert d['origem_sha256']==ref['sha256']and d['sha256']==sha(dest.read_bytes());out.append(d);continue
  x=ler_planilha(p,work);logs=x.attrs.get('import_errors',{});x.columns=[chave(c)for c in x.columns];x['uf']=x.uf.astype(str).map(chave).map(ufs);x=x[x.uf.notna()].copy();x['municipio']=x.municipio.astype(str).str.strip();x=x.rename(columns={next(c for c in x if'especie'in c):'especie',next(c for c in x if c in ['qtdveiculos','qtdeveiculos','qtdeveiculo','qtddeveiculos']):'quantidade'})
  x.quantidade=pd.to_numeric(x.quantidade,errors='raise');assert x.quantidade.notna().all()and(x.quantidade>=0).all()and(x.quantidade%1==0).all();x.quantidade=x.quantidade.astype('int64');cats=x.groupby('especie').quantidade.sum().to_dict();z=agrupar_especies(x)
  assert(z.mob_esp_total==z[['mob_esp_'+id for id,_ in ESPECIES]].sum(axis=1)).all();assert(z.mob_esp_total==z[['mob_eix_'+id for id in ['1','2','3','4','5_9','zero','outros']]].sum(axis=1)).all()
  z.to_parquet(dest,index=False,compression='zstd');d=dict(ano=ref['ano'],arquivo=dest.relative_to(fontes).as_posix(),sha256=sha(dest.read_bytes()),origem_sha256=ref['sha256'],especies_originais=cats,total=int(z.mob_esp_total.sum()),registros_log_importacao=logs);meta.write_bytes(compacto(d));out.append(d);print(json.dumps(dict(ano=ref['ano'],linhas=len(z),total=d['total'])),flush=True)
 (fontes/'normalizados_perfis.json').write_bytes(compacto(dict(ok=True,ausencias_dezembro=m['ausencias_dezembro'],arquivos=out)))

if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--fontes',type=Path,required=True);normalizar(p.parse_args().fontes)
