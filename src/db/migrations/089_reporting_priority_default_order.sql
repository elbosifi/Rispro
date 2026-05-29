do $$
begin
  if exists (
    select 1
    from reporting_priorities
    where (code = 'routine' and sort_order = 1)
       or (code = 'urgent' and sort_order = 2)
       or (code = 'stat' and sort_order = 3)
    group by 1
    having count(*) = 3
  ) then
    update reporting_priorities
       set sort_order = case code
         when 'stat' then 1
         when 'urgent' then 2
         when 'routine' then 3
         else sort_order
       end
     where code in ('stat', 'urgent', 'routine');
  end if;
end $$;
