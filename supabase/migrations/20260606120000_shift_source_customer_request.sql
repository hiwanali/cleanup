-- CleanUp · Nytt shift_source-värde för kundförfrågningar
-- Måste committas separat innan policyn i nästa migration kan använda värdet.

ALTER TYPE public.shift_source ADD VALUE IF NOT EXISTS 'customer_request';
