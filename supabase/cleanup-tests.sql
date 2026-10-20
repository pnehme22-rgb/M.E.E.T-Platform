-- Removes test data. Keeps the founder login (atelierpmn@gmail.com) and team access.

-- 1. The artist studio attached to the founder's email (its artworks go with it).
delete from artists where lower(email) = 'atelierpmn@gmail.com';

-- 2. The founder's own test application and the two test applications.
delete from applications
where lower(email) in ('atelierpmn@gmail.com',
                       'minds.exploring.traditions+test1@gmail.com',
                       'minds.exploring.traditions+test2@gmail.com');

-- 3. Check: what is left (should show only real applications, if any).
select reference, artist_name, email, status from applications order by created_at desc;
