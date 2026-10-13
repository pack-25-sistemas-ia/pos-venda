-- GERADO por scripts/gen-fixtures-sql.mjs a partir de tests/fixtures/rfm-cases.json. NÃO edite à mão.
-- Motor RFM puro (pv_rfm_scores / pv_rfm_classify): esperado calculado à mão; o TypeScript usa as mesmas fixtures.

do $$
begin
  assert public.pv_rfm_scores($j$[{"id":"a","r":10,"f":1,"m":500},{"id":"b","r":20,"f":2,"m":400},{"id":"c","r":30,"f":3,"m":300},{"id":"d","r":40,"f":4,"m":200},{"id":"e","r":50,"f":5,"m":100}]$j$::jsonb, 'percentile', $j${"r":[30,60,90,180],"f":[2,3,5,8],"m":[10000,30000,100000,300000]}$j$::jsonb) = $j$[{"id":"a","r_score":5,"f_score":1,"m_score":5},{"id":"b","r_score":4,"f_score":2,"m_score":4},{"id":"c","r_score":3,"f_score":3,"m_score":3},{"id":"d","r_score":2,"f_score":4,"m_score":2},{"id":"e","r_score":1,"f_score":5,"m_score":1}]$j$::jsonb, $m$notas: percentil: cinco clientes com ordem total (R é invertido: menor dias = nota maior)$m$;
  assert public.pv_rfm_scores($j$[{"id":"a","r":7,"f":2,"m":900},{"id":"b","r":7,"f":2,"m":900},{"id":"c","r":7,"f":2,"m":900},{"id":"d","r":7,"f":2,"m":900}]$j$::jsonb, 'percentile', $j${"r":[30,60,90,180],"f":[2,3,5,8],"m":[10000,30000,100000,300000]}$j$::jsonb) = $j$[{"id":"a","r_score":5,"f_score":1,"m_score":1},{"id":"b","r_score":5,"f_score":1,"m_score":1},{"id":"c","r_score":5,"f_score":1,"m_score":1},{"id":"d","r_score":5,"f_score":1,"m_score":1}]$j$::jsonb, $m$notas: percentil: todos iguais (distribuição concentrada) → mesma nota para todos (R 5, F 1, M 1)$m$;
  assert public.pv_rfm_scores($j$[{"id":"a","r":5,"f":1,"m":10},{"id":"b","r":5,"f":1,"m":10},{"id":"c","r":5,"f":3,"m":10}]$j$::jsonb, 'percentile', $j${"r":[30,60,90,180],"f":[2,3,5,8],"m":[10000,30000,100000,300000]}$j$::jsonb) = $j$[{"id":"a","r_score":5,"f_score":1,"m_score":1},{"id":"b","r_score":5,"f_score":1,"m_score":1},{"id":"c","r_score":5,"f_score":5,"m_score":1}]$j$::jsonb, $m$notas: percentil: empates parciais recebem a mesma nota (F = 1, 1, 3)$m$;
  assert public.pv_rfm_scores($j$[{"id":"a","r":40,"f":3,"m":5000}]$j$::jsonb, 'percentile', $j${"r":[30,60,90,180],"f":[2,3,5,8],"m":[10000,30000,100000,300000]}$j$::jsonb) = $j$[{"id":"a","r_score":5,"f_score":1,"m_score":1}]$j$::jsonb, $m$notas: percentil: um único cliente$m$;
  assert public.pv_rfm_scores($j$[{"id":"a","r":3,"f":1,"m":100},{"id":"b","r":300,"f":9,"m":9000}]$j$::jsonb, 'percentile', $j${"r":[30,60,90,180],"f":[2,3,5,8],"m":[10000,30000,100000,300000]}$j$::jsonb) = $j$[{"id":"a","r_score":5,"f_score":1,"m_score":1},{"id":"b","r_score":1,"f_score":5,"m_score":5}]$j$::jsonb, $m$notas: percentil: dois clientes$m$;
  assert public.pv_rfm_scores($j$[]$j$::jsonb, 'percentile', $j${"r":[30,60,90,180],"f":[2,3,5,8],"m":[10000,30000,100000,300000]}$j$::jsonb) = $j$[]$j$::jsonb, $m$notas: percentil: sem clientes$m$;
  assert public.pv_rfm_scores($j$[{"id":"1","r":30,"f":8,"m":300000},{"id":"2","r":181,"f":1,"m":9999},{"id":"3","r":61,"f":4,"m":99999},{"id":"4","r":90,"f":5,"m":100000},{"id":"5","r":180,"f":2,"m":10000},{"id":"6","r":31,"f":3,"m":30000},{"id":"7","r":0,"f":100,"m":5000000},{"id":"8","r":60,"f":2,"m":29999}]$j$::jsonb, 'fixed', $j${"r":[30,60,90,180],"f":[2,3,5,8],"m":[10000,30000,100000,300000]}$j$::jsonb) = $j$[{"id":"1","r_score":5,"f_score":5,"m_score":5},{"id":"2","r_score":1,"f_score":1,"m_score":1},{"id":"3","r_score":3,"f_score":3,"m_score":3},{"id":"4","r_score":3,"f_score":4,"m_score":4},{"id":"5","r_score":2,"f_score":2,"m_score":2},{"id":"6","r_score":4,"f_score":3,"m_score":3},{"id":"7","r_score":5,"f_score":5,"m_score":5},{"id":"8","r_score":4,"f_score":2,"m_score":2}]$j$::jsonb, $m$notas: limites fixos: bordas de cada faixa$m$;
  assert test.throws($q$select public.pv_rfm_scores($j$[]$j$::jsonb, 'magico', $j${"r":[30,60,90,180],"f":[2,3,5,8],"m":[10000,30000,100000,300000]}$j$::jsonb)$q$), $m$deve recusar: modo desconhecido$m$;
  assert test.throws($q$select public.pv_rfm_scores($j${}$j$::jsonb, 'percentile', $j${"r":[30,60,90,180],"f":[2,3,5,8],"m":[10000,30000,100000,300000]}$j$::jsonb)$q$), $m$deve recusar: linhas que não são lista$m$;
  assert public.pv_rfm_classify(5, 5, 5, 10, 300, 30) = 'campeoes', $m$segmento: campeão: R, F e M altos$m$;
  assert public.pv_rfm_classify(4, 4, 3, 6, 200, 30) = 'fieis', $m$segmento: fiel: R ≥ 3 e F ≥ 3 sem M alto$m$;
  assert public.pv_rfm_classify(3, 3, 1, 3, 200, 30) = 'fieis', $m$segmento: fiel: fronteira R = 3, F = 3$m$;
  assert public.pv_rfm_classify(5, 1, 1, 1, 10, 30) = 'novos', $m$segmento: novo: uma compra e primeira compra recente$m$;
  assert public.pv_rfm_classify(5, 1, 1, 1, 30, 30) = 'novos', $m$segmento: novo: fronteira exata de 30 dias$m$;
  assert public.pv_rfm_classify(5, 1, 1, 1, 31, 30) = 'promissores', $m$segmento: uma compra há 31 dias com R alto → promissor$m$;
  assert public.pv_rfm_classify(4, 2, 5, 3, 100, 30) = 'promissores', $m$segmento: promissor: R alto, F baixo$m$;
  assert public.pv_rfm_classify(3, 2, 2, 2, 100, 30) = 'atencao', $m$segmento: atenção: R = 3 com F baixo$m$;
  assert public.pv_rfm_classify(2, 3, 1, 4, 300, 30) = 'em_risco', $m$segmento: em risco: R baixo e F alto$m$;
  assert public.pv_rfm_classify(2, 1, 3, 1, 100, 30) = 'em_risco', $m$segmento: em risco: R baixo e M alto$m$;
  assert public.pv_rfm_classify(1, 5, 5, 9, 300, 30) = 'em_risco', $m$segmento: em risco: R = 1 com F e M altos$m$;
  assert public.pv_rfm_classify(1, 1, 1, 1, 400, 30) = 'atencao', $m$segmento: atenção: R baixo com F e M baixos$m$;
  raise notice 'PASS: motor RFM — 7 conjuntos de notas, 2 inválidos e 12 classificações';
end $$;
