-- =====================================================================
-- Orvya — remove os 13 produtos de exemplo da LocPress (vindos do seed inicial).
-- O catálogo da LocPress passa a vir da importação do Net Use.
-- Apaga só os itens do seed, pelo nome, sem código e sem preço — nada cadastrado depois.
-- =====================================================================
delete from public.products
where company_id = (select id from public.companies where slug = 'locpress')
  and code is null
  and sale_price is null
  and source = 'manual'
  and name in (
    'CPAP automático com umidificador',
    'BiPAP',
    'Máscara nasal para CPAP',
    'Concentrador de oxigênio 5 L',
    'Aspirador de secreção portátil',
    'Nebulizador',
    'Monitor multiparamétrico',
    'Oxímetro de pulso',
    'Cama hospitalar elétrica 3 movimentos',
    'Cama hospitalar manual 2 manivelas',
    'Colchão pneumático com compressor',
    'Cadeira de rodas dobrável',
    'Cadeira de banho com rodas'
  );
