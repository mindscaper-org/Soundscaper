# SPDX-License-Identifier: AGPL-3.0-only
cmake_minimum_required(VERSION 3.28)

# Adapt only the owned installed header, retaining zlib's notices and raw sources.
if(NOT DEFINED ZLIB_CONFIG_HEADER OR NOT IS_ABSOLUTE "${ZLIB_CONFIG_HEADER}"
    OR NOT EXISTS "${ZLIB_CONFIG_HEADER}" OR IS_DIRECTORY "${ZLIB_CONFIG_HEADER}"
    OR IS_SYMLINK "${ZLIB_CONFIG_HEADER}")
    message(FATAL_ERROR "A regular absolute installed zlib configuration header is required.")
endif()

file(READ "${ZLIB_CONFIG_HEADER}" header)
file(READ "${ZLIB_CONFIG_HEADER}" header_hex HEX)
set(original "#ifdef HAVE_UNISTD_H    /* may be set to #if 1 by ./configure */")
set(adapted "#if defined(HAVE_UNISTD_H) && (HAVE_UNISTD_H + 0) /* Soundscaper Windows adaptation: honor numeric feature macros. */    /* may be set to #if 1 by ./configure */")
string(FIND "${header}" "${original}" first)
string(REPLACE "${original}" "" remainder "${header}")
string(LENGTH "${header}" header_length)
string(LENGTH "${remainder}" remainder_length)
string(LENGTH "${original}" directive_length)
math(EXPR removed_length "${header_length} - ${remainder_length}")
if(first LESS 0 OR NOT removed_length EQUAL directive_length)
    message(FATAL_ERROR "The installed zlib header must contain its unique upstream HAVE_UNISTD_H directive.")
endif()
string(REPLACE "${original}" "${adapted}" header "${header}")
string(FIND "${header_hex}" "0d0a" crlf)
set(line_endings LF)
if(NOT crlf LESS 0)
    set(line_endings CRLF)
endif()
set(literal_at "@")
string(REPLACE "@" "@literal_at@" header "${header}")
file(CONFIGURE OUTPUT "${ZLIB_CONFIG_HEADER}" CONTENT "${header}" @ONLY NEWLINE_STYLE "${line_endings}")
