-- A Location holds only what is public or no closer than a grid square
-- (KI7MT, 2026-10-23: "we don't store anything that's not publicly
-- available"; "a grid square is enough"). What an earlier build kept is
-- taken out of every Location: street, city and postal code, latitude and
-- longitude, and the grid's extension past 8 characters.
UPDATE `station` SET `place` = json_remove(`place`, '$.MY_STREET', '$.MY_CITY', '$.MY_POSTAL_CODE', '$.MY_LAT', '$.MY_LON', '$.MY_GRIDSQUARE_EXT');
