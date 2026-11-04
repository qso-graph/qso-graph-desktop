-- A Location holds only what is public or no closer than a grid square:
-- nothing is stored that is not publicly available, and a grid square is
-- enough. What an earlier build kept is
-- taken out of every Location: street, city and postal code, latitude and
-- longitude, and the grid's extension past 8 characters.
UPDATE `station` SET `place` = json_remove(`place`, '$.MY_STREET', '$.MY_CITY', '$.MY_POSTAL_CODE', '$.MY_LAT', '$.MY_LON', '$.MY_GRIDSQUARE_EXT');
